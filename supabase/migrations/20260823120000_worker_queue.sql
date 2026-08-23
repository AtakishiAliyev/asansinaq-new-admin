-- Make the queue claimable by something that is not a browser tab.
--
-- Every queue RPC today assumes a signed-in admin, three times over. Each is
-- `security invoker` and opens with `if not public.is_admin() then raise`;
-- `is_admin()` resolves `auth.uid() -> auth.users -> admin_emails`; and the
-- lease identity is `auth.uid()` itself. A service-role connection has no
-- subject, so `auth.uid()` is null, `is_admin()` is false, and the function
-- refuses. Past even that, `claimed_by = auth.uid()` would store null and the
-- renew/release filters would compare `null = null` — never true — so a worker
-- could take rows and then never be able to renew or hand them back. It would
-- lose every batch to lease expiry and pay for it twice, which is the one
-- failure the queue was built to prevent.
--
-- So the worker gets its own claim/renew/release/finish: `security definer`,
-- granted to `service_role` alone, keyed by a text worker id instead of a user.
-- The browser's RPCs are left alone. The two lanes cannot disturb each other
-- because each matches on the identity column it sets — `claimed_by` for the
-- tab, `claimed_by_worker` for the worker — and a row carries one or the other,
-- never both.
--
-- The lease also has to stop being a constant. A batch submitted to the
-- Batches API usually comes back inside an hour and is allowed 24, against a
-- 15-minute `queue_lease()`. Every in-flight row would be swept and resubmitted
-- while the provider was still working on it. Expiry therefore becomes
-- per-row: `lease_until` when the claimer set one, the old constant when it did
-- not — which is exactly what keeps the browser path behaving as it does today.

alter table public.questions
  add column claimed_by_worker text,
  add column lease_until       timestamptz,
  add column batch_id          text,
  add column batch_custom_id   text,
  add column batch_stage       text
    check (batch_stage is null or batch_stage in ('extract', 'verify')),
  add column repair_round      smallint not null default 0
    check (repair_round >= 0);

comment on column public.questions.claimed_by_worker is
  'Lease holder when the claimer is a worker process rather than an admin tab. Mutually exclusive with claimed_by.';
comment on column public.questions.lease_until is
  'Explicit lease expiry. Null means the default queue_lease() window from claimed_at.';
comment on column public.questions.batch_id is
  'Provider batch this row is waiting on. Persisted so a restarted worker resumes polling instead of resubmitting and paying twice.';
comment on column public.questions.batch_custom_id is
  'This row''s key within the batch. Results come back unordered and must be matched by it, never by position.';
comment on column public.questions.batch_stage is
  'Which wave the row is in flight for: the extract pass or the verify pass.';
comment on column public.questions.repair_round is
  'How many times verification has sent this row back to be redone.';

-- The poll pass looks up exactly the rows holding a handle, which is a small
-- slice of a table meant to reach five figures.
create index questions_batch_idx
  on public.questions (batch_id)
  where batch_id is not null;

-- One definition of "this claim is up for grabs", so the two sweeps, enqueue,
-- clear_queue and the dashboard's running count cannot drift apart — the same
-- reason queue_lease() exists. A row that named its own expiry is judged by it;
-- one that did not falls back to the constant window.
create or replace function public.claim_expired(
  p_claimed_at  timestamptz,
  p_lease_until timestamptz
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_claimed_at is null
      or coalesce(p_lease_until, p_claimed_at + public.queue_lease()) < now();
$$;

revoke all on function public.claim_expired(timestamptz, timestamptz) from public, anon;
grant execute on function public.claim_expired(timestamptz, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The browser's RPCs, taught the per-row lease and the new columns.
-- Behaviour is unchanged wherever lease_until is null, which is every row a tab
-- has ever claimed.
-- ---------------------------------------------------------------------------

create or replace function public.claim_questions(
  p_limit   integer,
  p_book_id bigint default null
)
returns setof public.questions
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  update public.questions
     set queued_at = null,
         claimed_at = null,
         claimed_by_worker = null,
         lease_until = null,
         batch_id = null,
         batch_custom_id = null,
         batch_stage = null,
         status = case when status = 'cropped' then 'failed' else status end,
         extraction_error = case
           when status = 'cropped'
             then '3 cəhddən sonra işlənmədi — yenidən növbəyə salın'
           else extraction_error
         end
   where queued_at is not null
     and attempts >= 3
     and public.claim_expired(claimed_at, lease_until);

  return query
  update public.questions q
     set claimed_at = now(),
         claimed_by = auth.uid(),
         claimed_by_worker = null,
         lease_until = null,
         attempts = q.attempts + 1
   where q.id in (
     select c.id
       from public.questions c
      where c.queued_at is not null
        and c.attempts < 3
        and public.claim_expired(c.claimed_at, c.lease_until)
        and (p_book_id is null or c.book_id = p_book_id)
      order by c.queued_at, c.id
      limit greatest(1, least(p_limit, 50))
      for update skip locked
   )
  returning q.*;
end;
$$;

revoke all on function public.claim_questions(integer, bigint) from public, anon;
grant execute on function public.claim_questions(integer, bigint) to authenticated;

-- Re-queuing wipes the batch handle as well as the lease: a row handed back to
-- the queue must not still point at a batch, or the poll pass would adopt it
-- and write a stale result over whatever runs next.
create or replace function public.enqueue_questions(p_ids bigint[])
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  queued integer;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  update public.questions
     set queued_at = now(),
         claimed_at = null,
         claimed_by_worker = null,
         lease_until = null,
         batch_id = null,
         batch_custom_id = null,
         batch_stage = null,
         repair_round = 0,
         attempts = 0
   where id = any(p_ids)
     and public.claim_expired(claimed_at, lease_until);

  get diagnostics queued = row_count;
  return queued;
end;
$$;

revoke all on function public.enqueue_questions(bigint[]) from public, anon;
grant execute on function public.enqueue_questions(bigint[]) to authenticated;

create or replace function public.clear_queue()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  cleared integer;
  held    integer;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  select count(*) into held
    from public.questions
   where queued_at is not null
     and claimed_at is not null
     and not public.claim_expired(claimed_at, lease_until);

  update public.questions
     set queued_at = null,
         claimed_at = null,
         claimed_by_worker = null,
         lease_until = null,
         batch_id = null,
         batch_custom_id = null,
         batch_stage = null
   where queued_at is not null
     and public.claim_expired(claimed_at, lease_until);

  get diagnostics cleared = row_count;
  return jsonb_build_object('cleared', cleared, 'held', held);
end;
$$;

revoke all on function public.clear_queue() from public, anon;
grant execute on function public.clear_queue() to authenticated;

-- A worker batch holds its rows for hours. Counting "running" by the old
-- constant window would show them as stalled from fifteen minutes in.
create or replace function public.questions_throughput()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'queued', (
      select count(*) from public.questions
       where queued_at is not null and attempts < 3
    ),
    'running', (
      select count(*) from public.questions
       where claimed_at is not null
         and not public.claim_expired(claimed_at, lease_until)
    ),
    'structured_hour', (
      select count(*) from public.questions
       where status in ('structured', 'approved', 'rejected')
         and updated_at > now() - interval '1 hour'
    ),
    'structured_today', (
      select count(*) from public.questions
       where status in ('structured', 'approved', 'rejected')
         and updated_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc')
    ),
    'failed_today', (
      select count(*) from public.questions
       where status = 'failed'
         and updated_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc')
    ),
    'auto_approved_today', (
      select count(*) from public.questions
       where auto_approved
         and reviewed_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc')
    ),
    'spend_today', public.ops_spend_today()
  )
  where public.is_admin();
$$;

revoke all on function public.questions_throughput() from public, anon;
grant execute on function public.questions_throughput() to authenticated;

-- ---------------------------------------------------------------------------
-- The worker's own lane.
--
-- These are `security definer` because the caller has no user to authorise —
-- there is nothing for RLS to resolve. The guard below is depth, not the gate:
-- only `service_role` holds EXECUTE. It is written the same way
-- `ops_spend_today()` is, and for the same stated reason — a caller that IS a
-- user must still pass `is_admin()`, so a grant leaking to `authenticated` is
-- not on its own enough to let a signed-in non-admin spend money.
-- ---------------------------------------------------------------------------

create or replace function public.claim_questions_worker(
  p_worker_id text,
  p_limit     integer,
  p_lease     interval,
  p_book_id   bigint default null
)
returns setof public.questions
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and not (select public.is_admin()) then
    raise exception 'not authorized';
  end if;
  if p_worker_id is null or btrim(p_worker_id) = '' then
    raise exception 'worker id required';
  end if;
  if p_lease is null or p_lease <= interval '0' then
    raise exception 'lease must be positive';
  end if;

  update public.questions
     set queued_at = null,
         claimed_at = null,
         claimed_by_worker = null,
         lease_until = null,
         batch_id = null,
         batch_custom_id = null,
         batch_stage = null,
         status = case when status = 'cropped' then 'failed' else status end,
         extraction_error = case
           when status = 'cropped'
             then '3 cəhddən sonra işlənmədi — yenidən növbəyə salın'
           else extraction_error
         end
   where queued_at is not null
     and attempts >= 3
     and public.claim_expired(claimed_at, lease_until);

  return query
  update public.questions q
     set claimed_at = now(),
         lease_until = now() + p_lease,
         claimed_by_worker = p_worker_id,
         claimed_by = null,
         attempts = q.attempts + 1
   where q.id in (
     select c.id
       from public.questions c
      where c.queued_at is not null
        and c.attempts < 3
        and public.claim_expired(c.claimed_at, c.lease_until)
        and (p_book_id is null or c.book_id = p_book_id)
      order by c.queued_at, c.id
      limit greatest(1, least(p_limit, 50))
      for update skip locked
   )
  returning q.*;
end;
$$;

revoke all on function public.claim_questions_worker(text, integer, interval, bigint)
  from public, anon, authenticated;
grant execute on function public.claim_questions_worker(text, integer, interval, bigint)
  to service_role;

-- Heartbeat. Only the holder may renew, so a worker that died cannot keep rows
-- away from the one that replaced it.
create or replace function public.renew_claims_worker(
  p_worker_id text,
  p_ids       bigint[],
  p_lease     interval
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  renewed integer;
begin
  if (select auth.uid()) is not null and not (select public.is_admin()) then
    raise exception 'not authorized';
  end if;
  if p_lease is null or p_lease <= interval '0' then
    raise exception 'lease must be positive';
  end if;

  update public.questions
     set claimed_at = now(),
         lease_until = now() + p_lease
   where id = any(p_ids)
     and claimed_by_worker = p_worker_id
     and claimed_at is not null;

  get diagnostics renewed = row_count;
  return renewed;
end;
$$;

revoke all on function public.renew_claims_worker(text, bigint[], interval)
  from public, anon, authenticated;
grant execute on function public.renew_claims_worker(text, bigint[], interval) to service_role;

-- Handing work back deliberately is not a failed attempt, so the attempt is
-- returned — the same rule the browser lane follows, for the same reason.
create or replace function public.release_questions_worker(
  p_worker_id text,
  p_ids       bigint[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  released integer;
begin
  if (select auth.uid()) is not null and not (select public.is_admin()) then
    raise exception 'not authorized';
  end if;

  update public.questions
     set claimed_at = null,
         lease_until = null,
         claimed_by_worker = null,
         batch_id = null,
         batch_custom_id = null,
         batch_stage = null,
         attempts = greatest(0, attempts - 1)
   where id = any(p_ids)
     and claimed_by_worker = p_worker_id
     and claimed_at is not null;

  get diagnostics released = row_count;
  return released;
end;
$$;

revoke all on function public.release_questions_worker(text, bigint[])
  from public, anon, authenticated;
grant execute on function public.release_questions_worker(text, bigint[]) to service_role;

-- Work finished: the row leaves the queue. Unlike the browser's finish, which
-- is an unguarded table update any admin session can aim at any row, this one
-- only touches rows the calling worker actually holds.
create or replace function public.finish_questions_worker(
  p_worker_id text,
  p_ids       bigint[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  finished integer;
begin
  if (select auth.uid()) is not null and not (select public.is_admin()) then
    raise exception 'not authorized';
  end if;

  update public.questions
     set queued_at = null,
         claimed_at = null,
         lease_until = null,
         claimed_by_worker = null,
         batch_id = null,
         batch_custom_id = null,
         batch_stage = null
   where id = any(p_ids)
     and claimed_by_worker = p_worker_id;

  get diagnostics finished = row_count;
  return finished;
end;
$$;

revoke all on function public.finish_questions_worker(text, bigint[])
  from public, anon, authenticated;
grant execute on function public.finish_questions_worker(text, bigint[]) to service_role;

-- One thing worth writing down, because every migration in this repo is built
-- on the opposite assumption.
--
-- `revoke all on function … from public, anon; grant execute … to authenticated`
-- does NOT exclude service_role. Supabase's default privileges grant EXECUTE on
-- new functions in `public` to anon, authenticated AND service_role at creation
-- time, so revoking PUBLIC and anon leaves service_role's own grant standing.
-- Check `proacl`, not the migration that created it: claim_questions reads
-- {postgres=X, authenticated=X, service_role=X} despite never being granted to
-- service_role by name.
--
-- Which means service_role could always execute the queue RPCs. What stopped a
-- worker was never the grant — it was `is_admin()` resolving a subject that a
-- service-role connection does not have, and `auth.uid()` being the lease
-- identity. That is what the functions above replace.
--
-- The corollary is that the four worker functions above revoke from
-- `authenticated` explicitly. Granting to service_role alone would have left
-- the default grants in place and made them callable by any signed-in user,
-- who would then only have the in-body guard between them and the queue.
--
-- ops_summary_today() and ops_spend_daily() are reachable by service_role for
-- the same reason, and are `security invoker` with no predicate in their bodies
-- — so a service-role caller bypasses the ops_log RLS policy and reads the
-- unfiltered ledger. That is not an escalation: anything holding the service
-- key can already select ops_log directly. It is left as it is rather than
-- given a cosmetic revoke, and noted here so the next reader does not mistake
-- the grant list for the protection.

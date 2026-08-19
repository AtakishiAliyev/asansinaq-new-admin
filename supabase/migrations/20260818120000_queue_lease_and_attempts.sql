-- Lease renewal, honest attempt accounting, and sweeps that leave a trace.
--
-- Three things the first queue migration got wrong once a real book ran
-- through it:
--
-- 1. Every claim burned an attempt, including the ones the operator handed
--    back voluntarily — stopping the worker, or a batch left untouched when
--    the daily budget ran out. Three stop/starts and a row that had never
--    actually been attempted hit `attempts >= 3`.
-- 2. The sweep then dropped those rows with no status change: `queued_at`
--    went null, `status` stayed 'cropped', and the row became invisible —
--    not queued, not failed, counted nowhere. The queue just got shorter.
-- 3. A 15-minute lease with no way to renew it. A figure-heavy batch that
--    outruns the window is reclaimed by the next worker and paid for twice,
--    which is the one thing the queue exists to prevent.
--
-- An attempt now means "a worker took this row and did not come back", which
-- is the only reading under which three of them justify giving up.

-- One definition of the window, so the claim, the sweep, the renewal and the
-- dashboard's "running" count can never drift apart.
create or replace function public.queue_lease()
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '15 minutes' $$;

revoke all on function public.queue_lease() from public, anon;
grant execute on function public.queue_lease() to authenticated;

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

  -- A row that has burned its attempts leaves the queue — but it says so.
  -- Anything that never reached 'structured' is marked failed with a reason,
  -- so it shows up in the Diqqət lane and in failed_today instead of quietly
  -- disappearing from the count. A row a reviewer already ruled on keeps its
  -- verdict.
  update public.questions
     set queued_at = null,
         claimed_at = null,
         status = case when status = 'cropped' then 'failed' else status end,
         extraction_error = case
           when status = 'cropped'
             then '3 cəhddən sonra işlənmədi — yenidən növbəyə salın'
           else extraction_error
         end
   where queued_at is not null
     and attempts >= 3
     and (claimed_at is null or claimed_at < now() - public.queue_lease());

  return query
  update public.questions q
     set claimed_at = now(),
         claimed_by = auth.uid(),
         attempts = q.attempts + 1
   where q.id in (
     select c.id
       from public.questions c
      where c.queued_at is not null
        and c.attempts < 3
        and (c.claimed_at is null or c.claimed_at < now() - public.queue_lease())
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

-- Heartbeat. The worker calls this for the batch it is holding, so a long
-- batch keeps its rows instead of having them reclaimed and re-billed
-- underneath it. Only the holder can renew: a stale tab must not be able to
-- keep rows away from a live worker.
create or replace function public.renew_claims(p_ids bigint[])
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  renewed integer;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  update public.questions
     set claimed_at = now()
   where id = any(p_ids)
     and claimed_by = auth.uid()
     and claimed_at is not null;

  get diagnostics renewed = row_count;
  return renewed;
end;
$$;

revoke all on function public.renew_claims(bigint[]) from public, anon;
grant execute on function public.renew_claims(bigint[]) to authenticated;

-- Handing work back deliberately is not a failed attempt. Giving the attempt
-- back is what keeps stop/start from eroding the retry budget of rows that
-- were never processed.
create or replace function public.release_questions(p_ids bigint[])
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  released integer;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  update public.questions
     set claimed_at = null,
         attempts = greatest(0, attempts - 1)
   where id = any(p_ids)
     and claimed_by = auth.uid()
     and claimed_at is not null;

  get diagnostics released = row_count;
  return released;
end;
$$;

revoke all on function public.release_questions(bigint[]) from public, anon;
grant execute on function public.release_questions(bigint[]) to authenticated;

-- Enqueue skips rows a worker is actively holding. Resetting `claimed_at` and
-- `attempts` under a live lease let a second worker claim the same row while
-- the first was still spending money on it.
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
         attempts = 0
   where id = any(p_ids)
     and (claimed_at is null or claimed_at < now() - public.queue_lease());

  get diagnostics queued = row_count;
  return queued;
end;
$$;

revoke all on function public.enqueue_questions(bigint[]) from public, anon;
grant execute on function public.enqueue_questions(bigint[]) to authenticated;

-- The dashboard polls throughput every 5 seconds per open tab. Both of these
-- filters were sequential scans over a table meant to reach five figures.
create index if not exists questions_claimed_idx
  on public.questions (claimed_at)
  where claimed_at is not null;

create index if not exists questions_auto_approved_idx
  on public.questions (reviewed_at)
  where auto_approved;

-- Same window as the claim, and the same UTC day boundary the budget guard
-- uses — a dashboard that disagrees with the enforcement number is worse than
-- no dashboard.
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
         and claimed_at > now() - public.queue_lease()
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

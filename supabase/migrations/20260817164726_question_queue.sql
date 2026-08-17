-- A durable queue for structuring work.
--
-- Until now a structuring run lived entirely in one browser tab: closing it
-- lost the remaining work, two tabs would process the same question twice,
-- and nothing outside that tab could tell how much was left. A 10k-question
-- book cannot be built that way.
--
-- The queue is the questions table itself — a separate jobs table would
-- duplicate the natural key and let the two drift. `queued_at` marks work to
-- do; `claimed_at`/`claimed_by` is a LEASE, not a lock: a worker that dies
-- (tab closed, laptop asleep) simply stops renewing it and the row becomes
-- claimable again after the lease expires. Claims go through an RPC because
-- `for update skip locked` is the only way two workers can take disjoint
-- batches without a round trip each.
--
-- Also here:
--   questions.auto_approved — a row approved by rule rather than by a person,
--   so an audit can always separate the two.

alter table public.questions
  add column queued_at     timestamptz,
  add column claimed_at    timestamptz,
  add column claimed_by    uuid references public.profiles (id) on delete set null,
  add column attempts      smallint not null default 0,
  add column auto_approved boolean not null default false;

-- Partial: the queue is a small slice of a large table, and every claim
-- orders by queued_at.
create index questions_queued_idx
  on public.questions (queued_at, id)
  where queued_at is not null;

comment on column public.questions.queued_at is
  'Non-null while the question is waiting for or undergoing structuring.';
comment on column public.questions.claimed_at is
  'Lease start. A claim older than the lease window is reclaimable.';
comment on column public.questions.auto_approved is
  'Approved by the auto-approve rule, not by a reviewer.';

-- How long a worker may hold a claim without finishing. One batch of 8
-- questions runs 2-5 minutes; 15 gives a slow figure-heavy batch room to
-- finish before another tab picks the same rows up.
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

  -- A row that has burned its attempts leaves the queue instead of being
  -- retried forever: it stays visible as a failure, which is the honest
  -- state, rather than as work that will never complete.
  update public.questions
     set queued_at = null,
         claimed_at = null
   where queued_at is not null
     and attempts >= 3
     and (claimed_at is null or claimed_at < now() - interval '15 minutes');

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
        and (c.claimed_at is null or c.claimed_at < now() - interval '15 minutes')
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

-- The book a worker should drain next: whichever has waited longest. Workers
-- need the book to load its category tree, so they take one book at a time.
create or replace function public.next_queued_book()
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  select q.book_id
    from public.questions q
   where q.queued_at is not null
     and q.attempts < 3
     and public.is_admin()
   order by q.queued_at, q.id
   limit 1;
$$;

revoke all on function public.next_queued_book() from public, anon;
grant execute on function public.next_queued_book() to authenticated;

-- Throughput, in one round trip. Counting this client-side would mean
-- fetching every row of a table that is meant to reach five figures.
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
         and claimed_at > now() - interval '15 minutes'
    ),
    'structured_hour', (
      select count(*) from public.questions
       where status in ('structured', 'approved', 'rejected')
         and updated_at > now() - interval '1 hour'
    ),
    'structured_today', (
      select count(*) from public.questions
       where status in ('structured', 'approved', 'rejected')
         and updated_at > date_trunc('day', now())
    ),
    'failed_today', (
      select count(*) from public.questions
       where status = 'failed' and updated_at > date_trunc('day', now())
    ),
    'auto_approved_today', (
      select count(*) from public.questions
       where auto_approved and reviewed_at > date_trunc('day', now())
    ),
    'spend_today', coalesce((
      select sum(est_cost_usd) from public.ops_log
       where created_at > date_trunc('day', now())
    ), 0)
  )
  where public.is_admin();
$$;

revoke all on function public.questions_throughput() from public, anon;
grant execute on function public.questions_throughput() to authenticated;

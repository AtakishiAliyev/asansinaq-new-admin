-- Tell the queue panel how much work is waiting on the provider.
--
-- The panel used to show a progress bar driven by the browser's own run, which
-- worked because the browser WAS the worker. It is not any more, so the page
-- has to read the same facts a second operator on another machine would read —
-- from the database, which is where the queue has always lived.
--
-- `running` already counts rows a worker holds. It cannot distinguish a
-- question being prepared from one submitted to a batch that will answer in an
-- hour, and those look very different to someone deciding whether anything is
-- wrong: no visible progress for twenty minutes is alarming when a worker is
-- churning and completely normal when a batch is in flight.
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
    -- Submitted and waiting on the provider. A subset of `running`.
    'in_batch', (
      select count(*) from public.questions
       where batch_id is not null
         and claimed_at is not null
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

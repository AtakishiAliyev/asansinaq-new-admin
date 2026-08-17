-- When a question was last structured, as opposed to last touched.
--
-- Throughput was being read from `updated_at`, which every approval and every
-- reviewer edit also moves: a bulk approve of 300 questions looked exactly
-- like 300 questions coming out of the pipeline. A queue panel whose speed
-- number lies is worse than one with no speed number.

alter table public.questions add column structured_at timestamptz;

comment on column public.questions.structured_at is
  'Set by the structuring pipeline only. Never moved by review actions.';

create index questions_structured_at_idx
  on public.questions (structured_at desc)
  where structured_at is not null;

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
       where structured_at > now() - interval '1 hour'
    ),
    'structured_today', (
      select count(*) from public.questions
       where structured_at > date_trunc('day', now())
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

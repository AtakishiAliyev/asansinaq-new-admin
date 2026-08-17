-- Hardening of the question-ops cost controls added in 20260817121305,
-- after an adversarial review of the pipeline.

-- The Edge Function computed today's spend by selecting every ops_log row of
-- the day and summing them in TypeScript. PostgREST caps a response at 1000
-- rows, so from the 1001st op onward the sum silently under-reported and the
-- daily budget simply stopped capping. Summing in the database has no such
-- ceiling.
--
-- SECURITY DEFINER (needed once ops_log is no longer client-readable in every
-- context) means the body must state its own audience: the function's
-- service-role client, or an admin session. Anyone else sums nothing and gets
-- 0 rather than a peek at the day's spend.
--
-- The day boundary is converted back to timestamptz explicitly so the window
-- is UTC midnight regardless of the caller's session TimeZone.
create function public.ops_spend_today()
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(est_cost_usd), 0)
  from public.ops_log
  where created_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc')
    and (
      coalesce(
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
        ''
      ) = 'service_role'
      or (select public.is_admin())
    );
$$;

revoke execute on function public.ops_spend_today() from public, anon;
-- service_role needs the grant spelled out: revoking from public also took
-- away the implicit EXECUTE it inherited at creation.
grant execute on function public.ops_spend_today() to authenticated, service_role;

-- The ledger and the cache were writable straight from the browser by any
-- admin session. A forged ops_log row (negative or huge est_cost_usd) could
-- disable or trip the budget guard, and a forged ops_cache row could feed
-- poisoned model output back into the pipeline as a "cache hit". Both are now
-- written only by the Edge Function through the service role, which bypasses
-- RLS. The client keeps select on ops_log for the spend widget; it has no
-- reason to see ops_cache at all.
revoke insert, update, delete on public.ops_log from authenticated;
drop policy ops_log_insert on public.ops_log;

revoke all on public.ops_cache from authenticated;
drop policy ops_cache_insert on public.ops_cache;
drop policy ops_cache_delete on public.ops_cache;

-- A question whose extraction failed has no stem, and the CHECK exempted only
-- 'cropped' and 'failed' — so a reviewer marking that row 'rejected' violated
-- the constraint and could never clear it from the queue.
alter table public.questions
  drop constraint questions_structured_complete;
alter table public.questions
  add constraint questions_structured_complete
    check (
      status in ('cropped', 'failed', 'rejected')
      or (stem is not null and options is not null)
    );

-- ops_cache had no way to age out: nothing recorded which prompt generation
-- produced an entry, and nothing indexed how old one is. Rows are now
-- sweepable by generation (prompt_version < current) or by age, whenever a
-- cleanup job is added — deliberately none yet, the table is still small.
alter table public.ops_cache
  add column prompt_version smallint;

create index ops_cache_created_at_idx on public.ops_cache (created_at);

-- ops_spend_today() recognised its real caller — the question-ops function's
-- service-role client — by the role claim alone. That check is one-sided in a
-- dangerous direction: if it ever failed to match (a claim exposed under a
-- different GUC by a future PostgREST, a call made outside PostgREST), the
-- function would return 0, the daily budget would read "nothing spent yet"
-- and would silently stop capping — the exact failure the function was added
-- to prevent. Losing the cap must not be one config detail away.
--
-- So the non-user caller is now recognised two ways, and everything that IS a
-- user still has to pass is_admin(): only 'authenticated' and 'service_role'
-- may execute this, and an authenticated request always carries a subject, so
-- a missing auth.uid() means there is no end user to authorise.
create or replace function public.ops_spend_today()
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
      (select auth.uid()) is null
      or coalesce(auth.jwt() ->> 'role', '') = 'service_role'
      or (select public.is_admin())
    );
$$;

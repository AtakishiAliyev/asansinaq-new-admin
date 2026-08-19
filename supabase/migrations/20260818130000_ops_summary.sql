-- Spend, aggregated in SQL.
--
-- `ops_log` is written once per model call, so a book measured in thousands of
-- questions writes tens of thousands of rows a day. Summing that in the
-- browser would mean paging the whole day's ledger to render one number — and
-- PostgREST's 1000-row default would silently under-report it, which is the
-- same failure `ops_spend_today` was already written to avoid.

-- Today, per op: what it cost, how often the cache answered instead of a model.
create or replace function public.ops_summary_today()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(entry order by cost desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'op', op,
      'calls', count(*),
      'cached', count(*) filter (where cached),
      'cost', round(coalesce(sum(est_cost_usd), 0)::numeric, 4),
      'ms_p50', percentile_disc(0.5) within group (order by ms)
    ) as entry,
    coalesce(sum(est_cost_usd), 0) as cost
    from public.ops_log
    where created_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc')
    group by op
  ) s;
$$;

revoke all on function public.ops_summary_today() from public, anon;
grant execute on function public.ops_summary_today() to authenticated;

-- The last N days, one row each, so a multi-day job can be seen as a trend
-- rather than as today's number with no context.
create or replace function public.ops_spend_daily(p_days integer default 14)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'day', day,
    'cost', round(cost::numeric, 4),
    'calls', calls
  ) order by day), '[]'::jsonb)
  from (
    select
      (date_trunc('day', created_at at time zone 'utc'))::date as day,
      coalesce(sum(est_cost_usd), 0) as cost,
      count(*) as calls
    from public.ops_log
    where created_at >= (
      date_trunc('day', now() at time zone 'utc')
      - make_interval(days => greatest(1, least(p_days, 90)) - 1)
    ) at time zone 'utc'
    group by 1
  ) s;
$$;

revoke all on function public.ops_spend_daily(integer) from public, anon;
grant execute on function public.ops_spend_daily(integer) to authenticated;

-- No new index: `ops_log_created_at_idx` already covers both the day filters
-- above and the recency listing, since a btree scans backwards just as well.

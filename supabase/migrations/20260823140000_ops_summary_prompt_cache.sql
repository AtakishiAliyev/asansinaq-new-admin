-- Separate the two caches on the ops page.
--
-- `ops_log.cached` is a boolean meaning "our ops_cache answered instead of a
-- model", and the page divides it by calls to show a cache rate. The provider's
-- own prompt cache is a completely different mechanism recorded in a completely
-- different column (`cached_tokens`), and nothing surfaced it.
--
-- So the first batch lane run read 0% cache on a page where prompt caching was
-- in fact serving 47% of Haiku's tokens and 12% of Sonnet's. Both numbers were
-- correct and they were measuring different things; only one was visible. That
-- is not a mistake an operator makes once — it is the only reading the page
-- offered.
--
-- Now both are reported. `cached` keeps its meaning; `prompt_tokens` and
-- `cache_read_tokens` are added beside it so a rate can be computed against the
-- prompt tokens they are a fraction of.
--
-- Expect the prompt-cache rate to sit well under 100% on batch work and not to
-- be a fault: requests in one batch are processed spread out or concurrently,
-- so many are in flight before any has written the prefix. A flat zero across a
-- whole batch is the number that means something is broken.
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
      -- Our cache: a call that never reached a model at all.
      'cached', count(*) filter (where cached),
      -- The provider's: tokens inside calls that DID reach a model.
      'prompt_tokens', coalesce(sum(prompt_tokens), 0),
      'cache_read_tokens', coalesce(sum(cached_tokens), 0),
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

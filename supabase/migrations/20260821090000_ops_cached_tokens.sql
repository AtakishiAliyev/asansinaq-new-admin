-- How much of a request the provider served from its own cache.
--
-- The agent loop resends a fixed system prompt and a growing conversation on
-- every turn, which is exactly the shape prompt caching exists for — but our
-- cost column is computed from token counts we multiply ourselves, so a
-- discount applied upstream is invisible in it. Without this we cannot answer
-- whether caching is happening at all, let alone whether it is worth
-- configuring explicitly.
alter table public.ops_log add column cached_tokens integer;

comment on column public.ops_log.cached_tokens is
  'Prompt tokens the provider reported as served from cache, when it reports them.';

-- Cost controls for the question-ops pipeline.
--
-- ops_log: append-only record of every model call (tokens, ms, estimated
-- cost) — spend becomes visible per day/book instead of living only in
-- function console logs, and the Edge Function reads today's sum to enforce
-- a daily budget cap before spending more.
--
-- ops_cache: identical requests return their stored result instead of
-- re-billing the model — a re-sent crop (failed batch, operator retry) costs
-- nothing the second time. Keyed by a hash of the canonical request payload
-- (which includes the prompt version, so prompt changes invalidate cleanly).
-- Small JSON responses live in the row; generated images live in the
-- question-crops bucket under cache/ and the row stores the path.
--
-- questions.prompt_version: which prompt generation produced a row — without
-- it, a prompt regression cannot be traced back to affected questions.

create table public.ops_log (
  id             bigint generated always as identity primary key,
  op             text not null,
  model          text not null,
  prompt_tokens  integer,
  output_tokens  integer,
  ms             integer,
  est_cost_usd   numeric(10, 6) not null default 0,
  cached         boolean not null default false,
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now()
);

create index ops_log_created_at_idx on public.ops_log (created_at);

revoke all on public.ops_log from anon;
grant select, insert on public.ops_log to authenticated;
alter table public.ops_log enable row level security;

create policy ops_log_select on public.ops_log
  for select to authenticated using ((select public.is_admin()));
create policy ops_log_insert on public.ops_log
  for insert to authenticated with check ((select public.is_admin()));

create table public.ops_cache (
  key         text primary key,
  op          text not null,
  response    jsonb,
  image_path  text,
  model       text,
  created_at  timestamptz not null default now()
);

revoke all on public.ops_cache from anon;
grant select, insert, delete on public.ops_cache to authenticated;
alter table public.ops_cache enable row level security;

create policy ops_cache_select on public.ops_cache
  for select to authenticated using ((select public.is_admin()));
create policy ops_cache_insert on public.ops_cache
  for insert to authenticated with check ((select public.is_admin()));
create policy ops_cache_delete on public.ops_cache
  for delete to authenticated using ((select public.is_admin()));

alter table public.questions
  add column prompt_version smallint;

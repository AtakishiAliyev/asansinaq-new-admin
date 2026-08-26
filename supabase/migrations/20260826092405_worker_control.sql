-- The worker's control plane, so the operator never needs a terminal.
--
-- The worker PROCESS deliberately stays outside the browser: its independence
-- from any open tab is the whole point of running it as a daemon, and a run
-- that dies when someone closes a window is the thing the batch lane was built
-- to escape. What moves here is only the control plane — a switch the worker
-- reads, and a heartbeat it writes — so the UI can show what is happening and
-- ask for a pause without owning the work.
--
-- Both directions are POLLED rather than pushed. The worker already has a loop;
-- reading one row at the top of it costs nothing and needs no connection held
-- open, no webhook and no second failure mode. The cost is that a pause takes
-- effect at the end of the current pass rather than instantly, which is the
-- correct granularity anyway: a batch already submitted has already been paid
-- for, and abandoning it mid-flight would spend money for nothing.

-- ---------------------------------------------------------------- control ---

create table if not exists public.worker_control (
  -- Deliberately a single row. A per-worker switch invites the state where two
  -- workers disagree about whether work should be happening, and there is no
  -- operator question that shape answers.
  id smallint primary key default 1 check (id = 1),
  desired_state text not null default 'running'
    check (desired_state in ('running', 'paused')),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

comment on table public.worker_control is
  'One row. What the operator wants the worker to be doing; the worker reads it '
  'once per loop and honours a pause between passes, never mid-batch.';

insert into public.worker_control (id) values (1) on conflict (id) do nothing;

alter table public.worker_control enable row level security;

-- The client is untrusted, so the predicate is the same one every other policy
-- resolves through. The worker reaches this table with the service role, which
-- bypasses RLS by design.
drop policy if exists worker_control_read on public.worker_control;
create policy worker_control_read on public.worker_control
  for select to authenticated using (public.is_admin());

drop policy if exists worker_control_write on public.worker_control;
create policy worker_control_write on public.worker_control
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- No insert or delete policy: the single row is created here and must stay.

-- -------------------------------------------------------------- heartbeat ---

create table if not exists public.worker_heartbeat (
  worker_id text primary key,
  last_seen timestamptz not null default now(),
  -- What the worker is doing right now, in the worker's own words. Free text
  -- rather than an enum: the useful version names the batch, and a column that
  -- has to be migrated to say something new will end up saying nothing.
  activity text not null default 'idle',
  -- What it believes it is doing about the switch, so the UI can tell "paused
  -- because asked" from "not running at all".
  state text not null default 'running' check (state in ('running', 'paused')),
  spend_today numeric,
  budget_usd numeric,
  last_error text,
  last_error_at timestamptz,
  started_at timestamptz
);

comment on table public.worker_heartbeat is
  'One row per worker process, rewritten every poll. Age of last_seen is the '
  'only honest liveness signal: a worker that died cannot tell anyone.';

alter table public.worker_heartbeat enable row level security;

drop policy if exists worker_heartbeat_read on public.worker_heartbeat;
create policy worker_heartbeat_read on public.worker_heartbeat
  for select to authenticated using (public.is_admin());

-- Deliberately no client write policy. A heartbeat a browser could forge is
-- not a liveness signal.

-- ------------------------------------------------------- throughput counts --

-- Adds the two counts the control panel needs and the old one could not give:
-- how many rows are sitting inside a provider batch, and how many are waiting
-- on the verification wave. Both look like "nothing is happening" from the
-- outside and are the two states an operator most often mistakes for a stall.
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
    'in_batch', (
      select count(*) from public.questions where batch_id is not null
    ),
    'awaiting_verify', (
      select count(*) from public.questions
       where status = 'structured'
         and verified_at is null
         and queued_at is null
         and batch_id is null
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

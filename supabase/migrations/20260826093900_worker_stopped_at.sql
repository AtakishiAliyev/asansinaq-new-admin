-- When a worker stopped ON PURPOSE.
--
-- Liveness is the age of `last_seen`, which is right for a crash: a process that
-- died cannot report it, so silence is the only signal available. A DELIBERATE
-- stop is different — the worker is still there to say so — and with nowhere to
-- record it the panel showed a green, pulsing "running" beside the words
-- "stopped: signal" for the whole staleness window.
--
-- A column rather than a third `state` value, because stopping is not a state
-- the operator can ask for: `worker_control.desired_state` is the request, and
-- this is the process reporting what it actually did.
alter table public.worker_heartbeat
  add column if not exists stopped_at timestamptz;

comment on column public.worker_heartbeat.stopped_at is
  'Set when the process exits deliberately, cleared on every start and beat. '
  'Null does not mean alive — that is still judged from the age of last_seen.';

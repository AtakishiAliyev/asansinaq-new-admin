// The worker's half of the control plane.
//
// Two one-row conversations with the database, both polled inside the loop the
// worker already runs: it reads what the operator wants, and it says what it is
// doing. Nothing here can start or stop the process — that is the daemon's job
// and deliberately outside the browser — so the worst a UI can do is ask for a
// pause and watch the heartbeat stop moving.
//
// Everything is best-effort. A control plane that can take the worker down when
// the database blinks is worse than no control plane: the work is already
// claimed and paid for, and a network hiccup must not turn into a stalled queue.
import type { Db } from './db.ts'
import { config } from './config.ts'

export type DesiredState = 'running' | 'paused'

/**
 * What the operator wants.
 *
 * Defaults to running when the row cannot be read. The alternative — pausing on
 * a failed read — means a database blip silently stops a queue that nobody
 * asked to stop, and the operator sees a worker that is online and idle with no
 * explanation.
 */
export async function readDesiredState(db: Db): Promise<DesiredState> {
  const { data, error } = await db
    .from('worker_control')
    .select('desired_state')
    .eq('id', 1)
    .maybeSingle()
  if (error || !data) return 'running'
  return data.desired_state === 'paused' ? 'paused' : 'running'
}

/**
 * The operator's express override, read at the top of every pass.
 *
 * Defaults to FALSE when the row cannot be read, which is the opposite
 * reasoning to `readDesiredState` and for the same underlying rule: fail
 * towards the cheaper, more conservative behaviour. A blip that silently
 * switched a large queue to full price would be an expensive way to find out
 * the database was unreachable.
 */
export async function readExpressOverride(db: Db): Promise<boolean> {
  const { data, error } = await db
    .from('worker_control')
    .select('express')
    .eq('id', 1)
    .maybeSingle()
  if (error || !data) return false
  return data.express === true
}

export interface Heartbeat {
  activity: string
  state: DesiredState
  spendToday?: number
  lastError?: string | null
}

/**
 * Say what is happening, once per pass.
 *
 * `last_seen` is rewritten every time, because its AGE is the only honest
 * liveness signal available — a worker that has died cannot announce it, so the
 * UI has to infer death from silence rather than from a status field that would
 * still read "running".
 *
 * Failures are swallowed on purpose. This is telemetry; a worker that stopped
 * working because it could not report that it was working would be absurd.
 */
export async function beat(db: Db, hb: Heartbeat): Promise<void> {
  const row = {
    worker_id: config.WORKER_ID,
    last_seen: new Date().toISOString(),
    activity: hb.activity,
    state: hb.state,
    spend_today: hb.spendToday ?? null,
    budget_usd: config.DAILY_BUDGET_USD,
    // Cleared on every beat: a process that is beating has not stopped, and a
    // stale `stopped_at` would keep a live worker looking shut down.
    stopped_at: null,
    ...(hb.lastError === undefined
      ? {}
      : { last_error: hb.lastError, last_error_at: hb.lastError ? new Date().toISOString() : null }),
  }
  try {
    await db.from('worker_heartbeat').upsert(row, { onConflict: 'worker_id' })
  } catch {
    // Telemetry only.
  }
}

/** Record that this process has come up, and when. */
export async function announceStart(db: Db): Promise<void> {
  try {
    await db.from('worker_heartbeat').upsert(
      {
        worker_id: config.WORKER_ID,
        last_seen: new Date().toISOString(),
        activity: 'starting',
        state: 'running',
        started_at: new Date().toISOString(),
        stopped_at: null,
        budget_usd: config.DAILY_BUDGET_USD,
        last_error: null,
        last_error_at: null,
      },
      { onConflict: 'worker_id' },
    )
  } catch {
    // Telemetry only.
  }
}

/**
 * Mark the worker offline on a clean exit.
 *
 * Only reachable when the process stops on purpose. A crash leaves the last
 * heartbeat where it was and the UI works it out from the age, which is exactly
 * what should happen — a status written by a process that is gone would be a
 * lie told by a dead worker.
 */
export async function announceStop(db: Db, reason: string): Promise<void> {
  try {
    await db
      .from('worker_heartbeat')
      .update({
        activity: `stopped: ${reason}`,
        last_seen: new Date().toISOString(),
        stopped_at: new Date().toISOString(),
      })
      .eq('worker_id', config.WORKER_ID)
  } catch {
    // Telemetry only.
  }
}

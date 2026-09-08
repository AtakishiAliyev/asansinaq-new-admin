import { beat, type DesiredState } from './control.ts'
import { db } from './db.ts'
import { spendToday } from './ops.ts'

// What the worker says it is doing, and how often.
//
// The control panel judges liveness by the AGE of the heartbeat, never by a
// status field — a process that died cannot report that it died. So a long
// pass has to keep talking: the panel counts a worker offline after 150
// seconds of silence, and a beat once per pass was not enough. An express run
// of 54 questions took 197 seconds, and the poll pass cuts, reproduces and
// OCRs every figure of a batch before it beats again. A healthy worker went
// "offline" in the UI in the middle of its own run — and a restart is the
// natural thing to do about an offline worker, which is the one thing a run in
// progress cannot afford.

/** What the worker is doing, as the control panel will phrase it. */
let activity = 'starting'
let lastBeat = 0

export async function setActivity(
  text: string,
  state: DesiredState = 'running',
): Promise<void> {
  activity = text
  lastBeat = Date.now()
  await beat(db, {
    activity,
    state,
    spendToday: await spendToday(db).catch(() => undefined),
  })
}

const PULSE_MS = 20_000

/** Beat with progress, but no more often than PULSE_MS. Cheap enough to call
 *  after every row. */
export async function pulse(text: string): Promise<void> {
  if (Date.now() - lastBeat < PULSE_MS) return
  await setActivity(text).catch(() => {})
}

// Paces every model call the app makes.
//
// Raising question concurrency only helps until the providers' own limits are
// hit; past that point the extra parallelism converts into 429s, and a 429 is
// worse than waiting because the question fails and its earlier paid steps
// have to be redone. So all calls pass through one gate: it caps how many are
// in flight, and when a provider says "too fast" every caller backs off
// together and the ceiling drops, recovering only after a run of clean calls.

const MAX_IN_FLIGHT = 12
const MIN_IN_FLIGHT = 2
const FIRST_BACKOFF_MS = 3_000
const MAX_BACKOFF_MS = 60_000
/** clean calls needed before the ceiling is raised again */
const RECOVERY_STREAK = 12

let ceiling = MAX_IN_FLIGHT
let inFlight = 0
let pauseUntil = 0
let backoffMs = FIRST_BACKOFF_MS
let cleanStreak = 0
let budgetExhausted = false
const waiting: (() => void)[] = []

function pump(): void {
  while (waiting.length && inFlight < ceiling && Date.now() >= pauseUntil) {
    inFlight++
    waiting.shift()?.()
  }
  if (waiting.length && Date.now() < pauseUntil) {
    setTimeout(pump, Math.max(50, pauseUntil - Date.now()))
  }
}

export async function acquireSlot(): Promise<void> {
  if (inFlight < ceiling && Date.now() >= pauseUntil) {
    inFlight++
    return
  }
  await new Promise<void>((resolve) => {
    waiting.push(resolve)
    pump()
  })
}

export function releaseSlot(): void {
  inFlight = Math.max(0, inFlight - 1)
  pump()
}

/** A provider refused for pace: hold everyone, then let fewer through. */
export function noteRateLimit(): void {
  pauseUntil = Date.now() + backoffMs
  backoffMs = Math.min(MAX_BACKOFF_MS, backoffMs * 2)
  ceiling = Math.max(MIN_IN_FLIGHT, Math.floor(ceiling / 2))
  cleanStreak = 0
}

export function noteSuccess(): void {
  cleanStreak++
  if (cleanStreak >= RECOVERY_STREAK && ceiling < MAX_IN_FLIGHT) {
    ceiling++
    cleanStreak = 0
    backoffMs = FIRST_BACKOFF_MS
    pump()
  }
}

/** The daily budget is a hard stop, not a pace problem — nothing retries. */
export function noteBudgetExhausted(): void {
  budgetExhausted = true
}

export function isBudgetExhausted(): boolean {
  return budgetExhausted
}

export function resetRateGate(): void {
  ceiling = MAX_IN_FLIGHT
  pauseUntil = 0
  backoffMs = FIRST_BACKOFF_MS
  cleanStreak = 0
  budgetExhausted = false
  pump()
}

export function gateStatus(): { ceiling: number; inFlight: number; pausedMs: number } {
  return {
    ceiling,
    inFlight,
    pausedMs: Math.max(0, pauseUntil - Date.now()),
  }
}

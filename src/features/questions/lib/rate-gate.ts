// Paces every model call the app makes.
//
// Raising question concurrency only helps until the providers' own limits are
// hit; past that point the extra parallelism converts into 429s, and a 429 is
// worse than waiting because the question fails and its earlier paid steps
// have to be redone. So all calls pass through one gate: it caps how many are
// in flight, and when a provider says "too fast" every caller backs off
// together and the ceiling drops, recovering only after a run of clean calls.
//
// The two lanes exist because image generation does not behave like the text
// models. Text calls run at twelve in flight without complaint. Images queue
// on the provider's side instead of being refused, so the same pressure comes
// back as latency: measured over one book, gpt-image averaged 42 s alone and
// 91 s once a dozen calls were in flight, with a third of them crossing 100 s
// against a 140 s abort. Those aborts then cost a retry, which adds pressure,
// which lengthens the queue. Holding images to a few at a time makes each one
// finish inside its budget, and finishing beats starting.

export type Lane = 'text' | 'image'

const LIMITS: Record<Lane, { max: number; min: number }> = {
  text: { max: 12, min: 2 },
  image: { max: 3, min: 1 },
}

const FIRST_BACKOFF_MS = 3_000
const MAX_BACKOFF_MS = 60_000
/** clean calls needed before the ceiling is raised again */
const RECOVERY_STREAK = 12

interface LaneState {
  ceiling: number
  inFlight: number
  pauseUntil: number
  backoffMs: number
  cleanStreak: number
  waiting: (() => void)[]
}

function freshLane(lane: Lane): LaneState {
  return {
    ceiling: LIMITS[lane].max,
    inFlight: 0,
    pauseUntil: 0,
    backoffMs: FIRST_BACKOFF_MS,
    cleanStreak: 0,
    waiting: [],
  }
}

const lanes: Record<Lane, LaneState> = {
  text: freshLane('text'),
  image: freshLane('image'),
}

// The daily budget is a property of the account, not of a lane.
let budgetExhausted = false

function pump(lane: Lane): void {
  const s = lanes[lane]
  while (s.waiting.length && s.inFlight < s.ceiling && Date.now() >= s.pauseUntil) {
    s.inFlight++
    s.waiting.shift()?.()
  }
  if (s.waiting.length && Date.now() < s.pauseUntil) {
    setTimeout(() => pump(lane), Math.max(50, s.pauseUntil - Date.now()))
  }
}

export async function acquireSlot(lane: Lane = 'text'): Promise<void> {
  const s = lanes[lane]
  if (s.inFlight < s.ceiling && Date.now() >= s.pauseUntil) {
    s.inFlight++
    return
  }
  await new Promise<void>((resolve) => {
    s.waiting.push(resolve)
    pump(lane)
  })
}

export function releaseSlot(lane: Lane = 'text'): void {
  const s = lanes[lane]
  s.inFlight = Math.max(0, s.inFlight - 1)
  pump(lane)
}

/** A provider refused for pace: hold that lane, then let fewer through. */
export function noteRateLimit(lane: Lane = 'text'): void {
  const s = lanes[lane]
  s.pauseUntil = Date.now() + s.backoffMs
  s.backoffMs = Math.min(MAX_BACKOFF_MS, s.backoffMs * 2)
  s.ceiling = Math.max(LIMITS[lane].min, Math.floor(s.ceiling / 2))
  s.cleanStreak = 0
}

export function noteSuccess(lane: Lane = 'text'): void {
  const s = lanes[lane]
  s.cleanStreak++
  if (s.cleanStreak >= RECOVERY_STREAK && s.ceiling < LIMITS[lane].max) {
    s.ceiling++
    s.cleanStreak = 0
    s.backoffMs = FIRST_BACKOFF_MS
    pump(lane)
  }
}

/**
 * A call that ran out of wall clock. Not a refusal, so it must not halve the
 * ceiling the way a 429 does — but it is the same signal in slow motion, and
 * ignoring it lets a lane sit at a pace where every call aborts.
 */
export function noteTimeout(lane: Lane = 'text'): void {
  const s = lanes[lane]
  s.ceiling = Math.max(LIMITS[lane].min, s.ceiling - 1)
  s.cleanStreak = 0
}

/** The daily budget is a hard stop, not a pace problem — nothing retries. */
export function noteBudgetExhausted(): void {
  budgetExhausted = true
}

export function isBudgetExhausted(): boolean {
  return budgetExhausted
}

export function resetRateGate(): void {
  for (const lane of Object.keys(lanes) as Lane[]) {
    const waiting = lanes[lane].waiting
    const inFlight = lanes[lane].inFlight
    lanes[lane] = { ...freshLane(lane), waiting, inFlight }
    pump(lane)
  }
  budgetExhausted = false
}

export function gateStatus(): Record<
  Lane,
  { ceiling: number; inFlight: number; waiting: number; pausedMs: number }
> {
  const read = (lane: Lane) => ({
    ceiling: lanes[lane].ceiling,
    inFlight: lanes[lane].inFlight,
    waiting: lanes[lane].waiting.length,
    pausedMs: Math.max(0, lanes[lane].pauseUntil - Date.now()),
  })
  return { text: read('text'), image: read('image') }
}

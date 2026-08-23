import {
  acquireSlot,
  gateStatus,
  noteRateLimit,
  noteTimeout,
  releaseSlot,
  resetRateGate,
} from '@/features/questions/lib/rate-gate'
import { eq, ok, suite } from '../harness.ts'

// resetRateGate deliberately KEEPS inFlight and waiting — zeroing them while
// real calls are outstanding would over-admit, so it is not a test reset. A
// case that acquires must therefore hand every slot back itself, or it leaves
// the lane full and the next case waits on it forever.
async function drain(lane: 'text' | 'image', held: number): Promise<void> {
  for (let i = 0; i < held; i++) releaseSlot(lane)
  await Promise.resolve()
  eq(gateStatus()[lane].inFlight, 0, `${lane} zolağı boşalmadı`)
  eq(gateStatus()[lane].waiting, 0, `${lane} zolağında gözləyən qaldı`)
}

// Measured on one book: gpt-image averaged 42 s with a few calls in flight and
// 91 s with a dozen, a third of them crossing 100 s against a 140 s abort. The
// image lane exists so pressure on the text models cannot drag images past
// their budget.
export const rateGateSuite = suite('rate-gate', {
  async 'the image lane fills long before the text lane does'() {
    resetRateGate()
    for (let i = 0; i < 3; i++) await acquireSlot('image')
    for (let i = 0; i < 8; i++) await acquireSlot('text')
    const s = gateStatus()
    eq(s.image.inFlight, 3)
    eq(s.text.inFlight, 8)
    // A fourth image must wait while the text lane still has room.
    let granted = false
    const pending = acquireSlot('image').then(() => (granted = true))
    await Promise.resolve()
    eq(granted, false)
    eq(s.text.inFlight < s.text.ceiling, true)
    // Let the parked waiter in before draining, so the lane ends at zero with
    // nothing still queued behind it.
    releaseSlot('image')
    await pending
    await drain('image', 3)
    await drain('text', 8)
  },

  async 'a lane that is refused slows only itself'() {
    resetRateGate()
    const before = gateStatus()
    noteRateLimit('image')
    const after = gateStatus()
    ok(after.image.ceiling < before.image.ceiling)
    eq(after.text.ceiling, before.text.ceiling)
    resetRateGate()
  },

  'a wall-clock abort lowers the ceiling by one, not by half'() {
    resetRateGate()
    const before = gateStatus().text.ceiling
    noteTimeout('text')
    eq(gateStatus().text.ceiling, before - 1)
    resetRateGate()
  },

  'no lane can be starved below its floor'() {
    resetRateGate()
    for (let i = 0; i < 12; i++) noteRateLimit('image')
    ok(gateStatus().image.ceiling >= 1)
    resetRateGate()
  },

  async 'releasing hands the slot to whoever is waiting'() {
    resetRateGate()
    for (let i = 0; i < 3; i++) await acquireSlot('image')
    let granted = false
    const pending = acquireSlot('image').then(() => (granted = true))
    releaseSlot('image')
    await pending
    eq(granted, true)
    await drain('image', 3)
  },
})

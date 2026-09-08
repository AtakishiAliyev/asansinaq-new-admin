// Which lane a pass takes, and the concurrency helper that paces it.
//
// The decision spends money either way, so it is worth pinning rather than
// inferring from a live run: choosing batch for a set someone is watching costs
// them ten minutes of waiting, and choosing express for a bulk import costs
// twice the token price across thousands of questions. Which is why it is the
// operator's switch alone — they are the one paying for whichever way it goes.
import { mapLimit, shouldExpress } from '../../worker/pace.ts'
import { eq, ok, suite } from '../harness.ts'

export const expressSuite = suite('express', {
  // The switch, and nothing else. An earlier rule escalated to express on its
  // own for any set at or under a threshold, which made the lane something the
  // operator could not predict: one live run of 40 questions split across both
  // lanes by nothing but which pass saw how much work, so half came back in a
  // minute and half sat in the provider's queue.
  'the operator switch decides, at every size'() {
    ok(shouldExpress(3, { operatorWants: true }), 'three, express')
    ok(shouldExpress(1000, { operatorWants: true }), 'a thousand, still express')
    ok(!shouldExpress(3, { operatorWants: false }), 'three, batch')
    ok(!shouldExpress(1000, { operatorWants: false }), 'a thousand, batch')
  },

  'nothing pending is neither lane'() {
    ok(!shouldExpress(0, { operatorWants: true }), 'nothing to run')
    ok(!shouldExpress(0, { operatorWants: false }), 'still nothing to run')
  },

  async 'the concurrency limit is respected and order is preserved'() {
    let running = 0
    let peak = 0
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    const out = await mapLimit(items, 3, async (n: number) => {
      running++
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, 5))
      running--
      return n * 2
    })
    ok(peak <= 3, `never more than three at once, saw ${peak}`)
    ok(peak > 1, `and genuinely concurrent, saw ${peak}`)
    eq(out.join(','), '2,4,6,8,10,12,14,16,18,20', 'results stay in input order')
  },

  // The whole point of express is that a slow question does not hold up the
  // others. If the pool waited for each batch of three, this would take three
  // rounds of the slowest member; it should instead keep every slot busy.
  async 'a slow item does not stall the ones behind it'() {
    const finished: number[] = []
    await mapLimit([0, 1, 2, 3, 4, 5], 2, async (n: number) => {
      await new Promise((resolve) => setTimeout(resolve, n === 0 ? 60 : 5))
      finished.push(n)
    })
    eq(finished[finished.length - 1], 0, 'the slow one finishes last, alone')
    ok(finished.length === 6, 'and everything still completes')
  },

  async 'an empty set does no work'() {
    const out = await mapLimit([], 4, async () => 1)
    eq(out.length, 0, 'nothing in, nothing out')
  },
})

// Which lane a pass takes, and the concurrency helper that paces it.
//
// The decision spends money either way, so it is worth pinning rather than
// inferring from a live run: choosing batch for a set someone is watching costs
// them ten minutes of waiting, and choosing express for a bulk import costs
// twice the token price across thousands of questions.
import { mapLimit, shouldExpress } from '../../worker/pace.ts'
import { eq, ok, suite } from '../harness.ts'

export const expressSuite = suite('express', {
  'a small set goes express on its own'() {
    ok(
      shouldExpress(8, { threshold: 20, operatorWants: false }),
      'eight questions is a set someone is watching',
    )
  },

  'a bulk set stays on batch'() {
    ok(
      !shouldExpress(500, { threshold: 20, operatorWants: false }),
      'an import must not quietly run at full price',
    )
  },

  'the operator can force express for a large set'() {
    ok(
      shouldExpress(500, { threshold: 20, operatorWants: true }),
      'someone waiting on a large set may pay to skip the queue',
    )
  },

  // The toggle only ever turns express ON. There is no reason to make anyone
  // wait for a batch queue to process four questions, so a small set is not
  // something the flag pushes back onto batch.
  'the toggle cannot push a small set back onto batch'() {
    ok(
      shouldExpress(3, { threshold: 20, operatorWants: false }),
      'small stays express regardless of the flag',
    )
  },

  'an empty queue is neither'() {
    ok(!shouldExpress(0, { threshold: 20, operatorWants: true }), 'nothing to run')
  },

  'the threshold boundary is inclusive'() {
    ok(shouldExpress(20, { threshold: 20, operatorWants: false }), 'at the threshold')
    ok(!shouldExpress(21, { threshold: 20, operatorWants: false }), 'past it')
  },

  // A threshold of zero is how the lane is switched off entirely: bulk
  // behaviour for everything, unless the operator asks otherwise.
  'a zero threshold means batch unless the operator asks'() {
    ok(!shouldExpress(1, { threshold: 0, operatorWants: false }), 'off by threshold')
    ok(shouldExpress(1, { threshold: 0, operatorWants: true }), 'still available by hand')
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

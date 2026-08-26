// What a call costs. The numbers feed the daily budget guard, so a rate that
// is wrong in the cheap direction does not produce a slightly wrong figure on a
// page — it produces a cap that stopped capping.
import { estimateCost, isKnownModel, rateFor, UNKNOWN_RATE } from '@/core/models'
import { ok, suite } from '../harness.ts'

const usage = (input: number, output: number) => ({
  input,
  cacheWrite: 0,
  cacheRead: 0,
  output,
})

export const modelsSuite = suite('models', {
  'an unrecognised model is priced at the most expensive tier'() {
    const rate = rateFor('some-model-nobody-added')
    ok(rate === UNKNOWN_RATE, 'an unknown model must not be cheap')
    ok(!isKnownModel('some-model-nobody-added'), 'and must not claim to be known')
  },

  // The figure-reproduction lane bills image output as a flat token count per
  // image, at a rate unrelated to the text lanes. It priced correctly by
  // ACCIDENT before it was listed — the fallback happened to land near the
  // truth — and an accident stops being true the day either number moves.
  'the figure generation lane is priced explicitly, not by the fallback'() {
    const rate = rateFor('gemini-2.5-flash-image')
    ok(rate !== UNKNOWN_RATE, 'the image lane must have a rate of its own')
    ok(isKnownModel('gemini-2.5-flash-image'), 'and must be recognised as priced')
    // ~1290 output tokens is one 1024px image.
    const perFigure = estimateCost('gemini-2.5-flash-image', usage(700, 1290))
    ok(
      perFigure > 0.02 && perFigure < 0.08,
      `a figure should cost a few cents, got ${perFigure}`,
    )
  },

  'an image model still counts toward the same budget as the text lanes'() {
    ok(estimateCost('gemini-2.5-flash-image', usage(0, 0)) === 0, 'nothing used, nothing owed')
    ok(
      estimateCost('gemini-2.5-flash-image', usage(700, 1290)) >
        estimateCost('claude-haiku-4-5', usage(700, 1290)),
      'a drawn figure costs more than the text call it accompanies',
    )
  },

  'batch work is priced at half of synchronous'() {
    const sync = estimateCost('claude-sonnet-5', usage(1000, 500), false)
    const batch = estimateCost('claude-sonnet-5', usage(1000, 500), true)
    ok(Math.abs(batch * 2 - sync) < 1e-12, `batch must halve, got ${batch} vs ${sync}`)
  },
})

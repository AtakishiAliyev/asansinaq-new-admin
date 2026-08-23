// Which model runs a lane. The facts about those models — what they cost, what
// parameters they take — live in @/core/models, because the Edge Function needs
// the same answers and a second rate table is one that drifts cheap.
//
// The ids themselves come from config and never from here: which model serves a
// lane is a question for an eval, not a constant in a library.
import type { ModelLane } from '@/core/extract/request-anthropic'
import { rateFor, isKnownModel } from '@/core/models'
import { config } from './config.ts'

export {
  acceptsSampling,
  estimateCost,
  promptTokens,
  samplingFor,
  usageFrom,
  type TokenUsage,
} from '@/core/models'

export function modelFor(lane: ModelLane): string {
  return lane === 'figure' ? config.MODEL_FIGURE : config.MODEL_TEXT
}

const warnedFor = new Set<string>()

/** Says out loud when a configured model is being priced by the fallback rate,
 *  once per id — silence there would look like a cheap model rather than an
 *  unknown one. */
export function warnIfUnpriced(model: string): void {
  if (isKnownModel(model) || warnedFor.has(model)) return
  warnedFor.add(model)
  const rate = rateFor(model)
  console.warn(
    `[cost] no rate known for "${model}" — pricing it at the highest known tier ` +
      `($${rate.input}/$${rate.output} per Mtok) so the budget guard cannot be ` +
      `talked into ignoring it. Add it to src/core/models.ts.`,
  )
}

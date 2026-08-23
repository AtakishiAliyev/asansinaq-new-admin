// Which model runs a lane, and what it cost.
//
// The ids come from config, never from here — see worker/config.ts for why.
// What this file owns is the arithmetic, and the arithmetic has one rule: when
// it is unsure, it must guess HIGH. The estimate feeds the daily budget guard,
// so an underestimate does not show up as a slightly wrong number on the ops
// page — it shows up as a cap that stopped capping.
import type { ModelLane } from '@/core/extract/request-anthropic'
import { config } from './config.ts'

export { acceptsSampling, samplingFor } from './sampling.ts'

export function modelFor(lane: ModelLane): string {
  return lane === 'figure' ? config.MODEL_FIGURE : config.MODEL_TEXT
}

/** Dollars per million tokens, list price. */
interface Rate {
  input: number
  output: number
}

// Matched by substring because the ids are configuration and may carry
// suffixes. Ordered most specific first.
const RATES: [RegExp, Rate][] = [
  [/haiku/i, { input: 1, output: 5 }],
  [/sonnet/i, { input: 3, output: 15 }],
  [/opus/i, { input: 5, output: 25 }],
]

// Anything unrecognised is billed at the most expensive tier we know. A new
// model id that nobody added a rate for must not read as free.
const UNKNOWN_RATE: Rate = { input: 5, output: 25 }

const warnedFor = new Set<string>()

export function rateFor(model: string): Rate {
  for (const [pattern, rate] of RATES) if (pattern.test(model)) return rate
  if (!warnedFor.has(model)) {
    warnedFor.add(model)
    console.warn(
      `[cost] no rate known for "${model}" — billing it at the highest known ` +
        `tier ($${UNKNOWN_RATE.input}/$${UNKNOWN_RATE.output} per Mtok) so the ` +
        `budget guard cannot be talked into ignoring it. Add it to worker/models.ts.`,
    )
  }
  return UNKNOWN_RATE
}

export interface TokenUsage {
  /** Prompt tokens billed at full price — the part no cache served. */
  input: number
  /** Written into the cache this call. Billed at a premium. */
  cacheWrite: number
  /** Served from cache. The reason the prefix is arranged the way it is. */
  cacheRead: number
  output: number
}

// Published multipliers: writing a cache entry costs more than plain input,
// reading one costs a fraction of it.
const CACHE_WRITE_MULTIPLIER = 1.25
const CACHE_READ_MULTIPLIER = 0.1
/** The Batches API bills at half of synchronous. */
const BATCH_MULTIPLIER = 0.5

export function estimateCost(
  model: string,
  usage: TokenUsage,
  viaBatch: boolean,
): number {
  const rate = rateFor(model)
  const promptCost =
    usage.input * rate.input +
    usage.cacheWrite * rate.input * CACHE_WRITE_MULTIPLIER +
    usage.cacheRead * rate.input * CACHE_READ_MULTIPLIER
  const outputCost = usage.output * rate.output
  const total = (promptCost + outputCost) / 1_000_000
  return viaBatch ? total * BATCH_MULTIPLIER : total
}

/** Every prompt token, however it was billed — what ops_log.prompt_tokens means. */
export function promptTokens(usage: TokenUsage): number {
  return usage.input + usage.cacheWrite + usage.cacheRead
}

export function usageFrom(raw: {
  input_tokens?: number | null
  output_tokens?: number | null
  cache_creation_input_tokens?: number | null
  cache_read_input_tokens?: number | null
}): TokenUsage {
  return {
    input: raw.input_tokens ?? 0,
    cacheWrite: raw.cache_creation_input_tokens ?? 0,
    cacheRead: raw.cache_read_input_tokens ?? 0,
    output: raw.output_tokens ?? 0,
  }
}

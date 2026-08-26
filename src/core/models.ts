// Facts about models, as opposed to decisions about them.
//
// In core because three runtimes need the same answers and there must be one
// of each: the worker prices a batch result, the Edge Function prices an
// interactive call, and the eval checks that an unknown model is priced
// defensively. A second copy of a rate table is a copy that drifts, and the
// direction it drifts in is "cheaper than reality".
//
// Model IDS are not here. Which model serves a lane is configuration — env in
// the worker, a secret in the function — and `request-anthropic.ts` resolves a
// lane precisely so it never has to know one. What lives here is what is true
// about a model whatever you call it.

/** Dollars per million tokens, list price. */
export interface Rate {
  input: number
  output: number
}

// Matched by substring: the ids are configuration and may carry suffixes.
const RATES: [RegExp, Rate][] = [
  [/haiku/i, { input: 1, output: 5 }],
  [/sonnet/i, { input: 3, output: 15 }],
  [/opus/i, { input: 5, output: 25 }],
  // The figure-reproduction lane. Image output is billed as OUTPUT TOKENS at a
  // flat count per image, so the per-token shape here is the provider's own and
  // not an approximation: a 1024px reproduction is ~1290 output tokens, which
  // at this rate is about four cents.
  //
  // It is listed because without it the lane priced at `UNKNOWN_RATE` and
  // happened to land near the truth — an accident that would have quietly
  // stopped being true the day either number moved. Re-check this row whenever
  // GEMINI_IMAGE_MODEL changes; unlike the text lanes, image pricing differs
  // sharply between models.
  [/gemini.*image|imagen|nano-banana/i, { input: 0.3, output: 30 }],
]

/**
 * What an unrecognised model costs: the most expensive tier we know of.
 *
 * The estimate feeds a daily budget guard, so guessing low does not produce a
 * slightly wrong number on a page — it produces a cap that stopped capping. A
 * model nobody added a rate for must never read as free.
 */
export const UNKNOWN_RATE: Rate = { input: 5, output: 25 }

export function rateFor(model: string): Rate {
  for (const [pattern, rate] of RATES) if (pattern.test(model)) return rate
  return UNKNOWN_RATE
}

export function isKnownModel(model: string): boolean {
  return RATES.some(([pattern]) => pattern.test(model))
}

export interface TokenUsage {
  /** Prompt tokens billed at full price — the part no cache served. */
  input: number
  /** Written into the cache this call. Billed at a premium. */
  cacheWrite: number
  /** Served from the provider's cache. */
  cacheRead: number
  output: number
}

const CACHE_WRITE_MULTIPLIER = 1.25
const CACHE_READ_MULTIPLIER = 0.1
/** The Batches API bills at half of synchronous. */
const BATCH_MULTIPLIER = 0.5

export function estimateCost(
  model: string,
  usage: TokenUsage,
  viaBatch = false,
): number {
  const rate = rateFor(model)
  const promptCost =
    usage.input * rate.input +
    usage.cacheWrite * rate.input * CACHE_WRITE_MULTIPLIER +
    usage.cacheRead * rate.input * CACHE_READ_MULTIPLIER
  const total = (promptCost + usage.output * rate.output) / 1_000_000
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

// Models that still accept sampling parameters.
//
// An ALLOWLIST. The current generation removed them and rejects the field
// outright ("`temperature` is deprecated for this model"), so an unrecognised
// id must default to sending nothing. Getting this backwards fails every
// request on the lane — which is exactly how the first live batch was lost.
const SAMPLING_MODELS = [/haiku/i, /sonnet-4/i, /opus-4-[0-5]/i]

export function acceptsSampling(model: string): boolean {
  return SAMPLING_MODELS.some((pattern) => pattern.test(model))
}

/**
 * The sampling parameters to send this model, which may be none at all.
 *
 * Temperature 0 is still worth sending where it is accepted — the recreation
 * must copy rather than compose — but determinism no longer rests on it. That
 * is the copy-only rules and the forced tool.
 */
export function samplingFor(model: string): { temperature?: number } {
  return acceptsSampling(model) ? { temperature: 0 } : {}
}

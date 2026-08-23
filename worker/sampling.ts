// Which models still take sampling parameters.
//
// Its own module, with no dependency on config, so a script can ask the
// question without booting the worker's whole environment — and so there is
// exactly one answer to it. A second copy of this rule living in a pre-flight
// check would drift from the one the worker actually uses, and the pre-flight
// would then pass on a request the worker cannot send.
//
// An ALLOWLIST, not a blocklist. The current generation removed sampling and
// rejects it outright ("`temperature` is deprecated for this model"), so an
// unrecognised id must default to sending nothing. Getting that backwards fails
// every request on the lane, which is how the first live run lost a batch.
const SAMPLING_MODELS = [/haiku/i, /sonnet-4/i, /opus-4-[0-5]/i]

export function acceptsSampling(model: string): boolean {
  return SAMPLING_MODELS.some((pattern) => pattern.test(model))
}

/**
 * The sampling parameters to send this model, which may be none at all.
 *
 * Temperature 0 is still worth sending where it is accepted — the recreation
 * must copy rather than compose — but it is no longer what determinism rests
 * on. That is the copy-only rules and the forced tool.
 */
export function samplingFor(model: string): { temperature?: number } {
  return acceptsSampling(model) ? { temperature: 0 } : {}
}

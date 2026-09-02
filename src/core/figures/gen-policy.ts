// Who redraws a figure, and who edits it when the verifier faults the redraw.
//
// Every cut figure on a `gen` book is reproduced. This file used to decline
// the redraw where the shading was the question; the operator overruled that
// once crops were rendered large enough for the reproduction itself to come
// out clean, and asked instead for the verifier's finding to go BACK to the
// image model as an edit request. So the policy now is a schedule: a first
// drawing, then up to MAX_GEN_EDITS corrective edits, each handed the cut,
// the current drawing and the verifier's words — and a different provider
// for the second edit when one is configured, because a model that has drawn
// the same thing wrong twice is rarely argued into it a third time.
//
// Pure: the schedule is pinned in the suite, and the worker only supplies
// which providers actually have a key.

export type GenProvider = 'gemini' | 'openai'

/** How many corrective edits a reproduction gets before the cut is shown. */
export const MAX_GEN_EDITS = 2

/**
 * The provider for edit round `round` (0 = the first edit), given the order
 * the operator configured and which of those providers are available. The
 * schedule walks the order; past its end the last available provider repeats;
 * with none available there is no edit and the cut is shown.
 */
export function pickEditProvider(
  round: number,
  order: GenProvider[],
  available: GenProvider[],
): GenProvider | null {
  const usable = order.filter((p) => available.includes(p))
  if (!usable.length) return null
  return usable[Math.min(round, usable.length - 1)] ?? null
}

/** `FIGURE_EDIT_PROVIDERS` as written by the operator, unknown names dropped. */
export function parseProviderOrder(text: string | undefined): GenProvider[] {
  const known: GenProvider[] = ['gemini', 'openai']
  const parsed = (text ?? '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter((t): t is GenProvider => (known as string[]).includes(t))
  return parsed.length ? parsed : known
}

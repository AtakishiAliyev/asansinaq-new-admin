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

/** The guard's verdict on a drawing it did not accept. */
export interface RefusedDrawing {
  /** Whether the geometry and colour comparison against the cut held. */
  structurePassed: boolean
  /**
   * Whether the OCR reading of the labels held, or null when it was not run.
   *
   * It is only run on a drawing whose structure already passed, so null here
   * means the structure is what failed.
   */
  writingPassed: boolean | null
}

/**
 * Whether a refused drawing is worth BUYING ANOTHER of.
 *
 * A second drawing is a second roll of the dice, and that is worth paying for
 * exactly when the dice are what went wrong. A structural or colour failure
 * qualifies: the model drew the figure differently from the cut, and drawing
 * it again may not.
 *
 * A WRITING failure does not. Structure and colour have already passed, so the
 * picture is the right picture; the only doubt is what an OCR engine could
 * read off it, and the model is not the component that failed. Redrawing
 * re-rolls a drawing nobody faulted against a reader whose false positives
 * this lane documents — on the operator's first two banks it was half of all
 * second attempts and about an eighth of the entire figure spend, and left the
 * row flagged either way. The reading objection is recorded and shown; it is
 * simply not something a second drawing can answer.
 */
export function shouldRedraw(verdict: RefusedDrawing): boolean {
  if (!verdict.structurePassed) return true
  return verdict.writingPassed !== false
}

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

// When the verifier's complaint is about the redraw, not the read.
//
// The verification wave compares OUR render against the crop, and on a `gen`
// book our render shows the reproduction. So a verdict can fail a row whose
// reading is perfect because the redraw moved a shaded region — and the
// pipeline answered that by re-reading the crop, which produced the same
// correct reading, the same redraw, and the same verdict, twice, at full
// price. Live: p302/8, verifier note "bütün C kvadratı boyanıb", read
// unchanged, two repairs.
//
// The right answer costs nothing: drop the reproduction, keep the cut — the
// source's own pixels — and let the wave rule on that instead. This decides
// when that is the answer: every critical difference is in the figure, and
// the figure on show is a reproduction. Pure, so the rule is pinned in the
// suite rather than inferred from a bill.

/** The verdict fields that describe the drawing rather than the text. */
const FIGURE_FIELDS: ReadonlySet<string> = new Set(['figure', 'figure_marks'])

/**
 * The indices of image figures whose reproduction the verdict blames, or an
 * empty list when the verdict is about something else (or nothing is shown
 * as a reproduction, in which case there is nothing to drop).
 */
export function reproductionBlamed(
  figures: unknown,
  differences: { field: string; severity: string }[],
): number[] {
  const items = (figures as { items?: unknown[] } | null)?.items
  if (!Array.isArray(items)) return []
  const shown = items
    .map((item, index) => ({ item: item as { kind?: string; genSrc?: string }, index }))
    .filter((e) => e.item.kind === 'image' && Boolean(e.item.genSrc))
    .map((e) => e.index)
  if (!shown.length) return []
  const critical = differences.filter((d) => d.severity === 'critical')
  if (!critical.length) return []
  if (!critical.every((d) => FIGURE_FIELDS.has(d.field))) return []
  return shown
}

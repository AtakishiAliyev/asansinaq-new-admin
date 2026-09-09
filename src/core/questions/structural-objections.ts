// The deterministic findings a second read can actually act on.
//
// The verification wave is a model comparing two pictures, and it is generous:
// on the page that prompted this it called three questions a match while our
// own measurements said the layout was wrong on all three — a stacked
// multiplication with both partial products in the same columns, another with
// the total written under no rule, and a division scheme with two roles crammed
// into one cell and one cell left empty. Every one was flagged in red and every
// one just sat there, because the repair round is driven by the WAVE's list of
// critical differences and nothing else. Caught, and not fixed.
//
// So these findings join that list. They are better evidence than the verdict,
// not worse: a measurement of the structure the model itself returned, with a
// message that says what is wrong in the terms the reader's own prompt uses.
// Fed back as repair notes they are a checklist the next read can test against
// the page.
//
// Narrow on purpose. A finding belongs here only if it is deterministic, about
// content rather than appearance, and ACTIONABLE — a re-read must have
// something concrete to do about it. `raster_figure` is deterministic and about
// content and belongs nowhere near this list, because there is nothing for a
// reader to change.
//
// Pure, and in core, so the list is argued about in one place, the worker
// merely submits it, and an eval can hold it.

/** The findings worth spending another read on, and the field each is about. */
export const REPAIRABLE_CODES: Record<string, string> = {
  // The stacked operations: the layout IS the question in a masked-digit
  // puzzle, and both of these say the columns do not line up.
  stack_result_unruled: 'figure',
  stack_indent_flat: 'figure',
  // The stack written into the stem as lines of text instead of drawn.
  column_sum_as_text: 'figure',
  // The Turkish division scheme: a role left empty, or two roles in one cell.
  division_role_empty: 'figure',
  division_role_crammed: 'figure',
  // A structured kind claiming a figure the DSL cannot hold. The message names
  // the remedy — `kind="image"` — so the next read has a clear instruction.
  kind_over_reach: 'figure',
}

export interface Objection {
  field: string
  severity: 'critical'
  note: string
}

/**
 * The repairable structural findings on a row, as verifier-shaped differences.
 *
 * Shaped like the wave's own output so that everything downstream — the repair
 * decision, `verify_diff`, the notes the next read is given — treats them the
 * same way, with no second path to keep in step.
 */
export function structuralObjections(flags: unknown): Objection[] {
  if (!Array.isArray(flags)) return []
  const out: Objection[] = []
  const seen = new Set<string>()
  for (const flag of flags) {
    const f = flag as { code?: unknown; level?: unknown; message?: unknown } | null
    const code = typeof f?.code === 'string' ? f.code : ''
    // Only errors. The same code at warning level is a reviewer's signal, and
    // paying for a read over one is how a lane spends its budget on opinions.
    if (f?.level !== 'error') continue
  // regress

    const field = REPAIRABLE_CODES[code]
    if (!field || seen.has(code)) continue
    seen.add(code)
    const message = typeof f?.message === 'string' ? f.message.trim() : ''
    out.push({ field, severity: 'critical', note: message || code })
  }
  return out
}

// Which of two drawings of the same figure the row keeps.
//
// A corrective edit used to be accepted the moment it came back: whatever the
// image model returned replaced the drawing it was asked to fix, unmeasured.
// The first live run of that showed what it costs. Ten questions went through,
// five of them earned an edit, and all five of those five came back WORSE than
// the drawing they replaced — a whole circle shaded where only a lens should
// be, a cross filled through its own centre, a rectangle that lost its right
// edge. The five rows no edit touched were fine. Every input to those drawings
// was identical except the edit, so the edit is what did it.
//
// This is the same lesson `questions/repair-guard.ts` records for text, and it
// was not applied here: keep the best version a repair produced, not the last
// one. The difference is which way a tie falls. There, a re-read answers a
// concrete finding a verifier made, so an equal score keeps the NEW version.
// Here the guard has already measured both drawings against the same cut, so a
// tie is evidence that nothing improved — and an unimproved redraw is a second
// roll of the dice on a figure that was already acceptable. Ties keep the
// INCUMBENT.
import type { StructuralDiff } from '@/core/figures/structural-diff'

export interface DrawingChoice {
  /** True when the edited drawing replaces the one it was asked to fix. */
  keepNew: boolean
  reason: string
}

/**
 * How much better the edit has to measure before it is worth taking.
 *
 * The guard's overlap figures move by a percent or two between two renderings
 * of the same picture, so a margin below that would let noise decide which
 * drawing a student sees.
 */
const MARGIN = 0.02

const pct = (n: number) => n.toFixed(2)

/**
 * Which drawing survives an edit round.
 *
 * `previous` and `next` are the guard's verdicts on the drawing being replaced
 * and on its replacement, both measured against the same cut. A null verdict
 * means the drawing could not be measured at all.
 */
export function decideDrawing(
  previous: StructuralDiff | null,
  next: StructuralDiff | null,
): DrawingChoice {
  if (!next) return { keepNew: false, reason: 'düzəliş ölçülə bilmədi' }
  // Nothing to compare against: the edit is the only measured drawing there is.
  if (!previous) return { keepNew: true, reason: 'əvvəlki çəkiliş ölçülməmişdi' }

  if (next.passed && !previous.passed) {
    return { keepNew: true, reason: 'düzəliş qoruyucudan keçdi, əvvəlki keçməmişdi' }
  }
  if (previous.passed && !next.passed) {
    return { keepNew: false, reason: 'əvvəlki çəkiliş qoruyucudan keçirdi, düzəliş keçmədi' }
  }

  // The edit is asked for because a shaded region moved, so colour is the axis
  // it has to improve on. Ink is checked only as a floor: a drawing that fixed
  // the shading by losing a line is not an improvement.
  const colourGain = next.colourIoU - previous.colourIoU
  const inkLoss = previous.inkIoU - next.inkIoU
  const shown = `rəng ${pct(previous.colourIoU)}→${pct(next.colourIoU)}`

  if (inkLoss > MARGIN) {
    return { keepNew: false, reason: `düzəliş xətləri itirdi (${pct(previous.inkIoU)}→${pct(next.inkIoU)})` }
  }
  if (colourGain > MARGIN) return { keepNew: true, reason: `düzəliş boyanı yaxşılaşdırdı (${shown})` }
  return { keepNew: false, reason: `düzəliş ölçüləbilən yaxşılaşma vermədi (${shown})` }
}

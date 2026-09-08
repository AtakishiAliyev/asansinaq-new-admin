import { verificationBlocked } from '@/core/questions/verification-block'

// Whether a question may be approved without a person looking at it.
//
// This is the only lever in the system that REMOVES work rather than moving it
// — reviewing ten thousand questions by hand is about twenty-eight hours — and
// it is also the only one that can put a wrong question in front of a student
// with nobody having seen it. So the rule is written once, in core, where it
// can be argued about and asserted offline, and it is deliberately a
// conjunction of things that already exist rather than a new judgement.
//
// What it trusts, and why each one is not enough alone:
//
//   * the verification wave said MATCH — a model comparing two pictures, which
//     on one live run called all ten rows a match while five were showing a
//     figure the deterministic guard had already objected to;
//   * no deterministic guard objection stands (`verificationBlocked`) — the
//     measurement that caught those five;
//   * the lint raised no ERROR — a venn with no sets, an unparseable
//     expression, a curve that does not render. Warnings are reviewer signals
//     and do not block: `raster_figure` is on essentially every figure question
//     on a `gen` book, because every drawn figure is cut from the original, so
//     blocking on it would mean auto-approve never fired on a figure at all;
//   * a category, which is the operator's own and is now chosen before the
//     crops are even sent;
//   * an answer, when the operator asks for one — a question with no answer is
//     not usable in an exam.

export interface AutoApproveSettings {
  enabled: boolean
  /** Pass only questions that already have an answer from the printed key. */
  needsAnswer: boolean
}

export interface AutoApprovableRow {
  status: string
  verified: boolean
  answer: string | null
  category_id: number | null
  flags: unknown
}

/** Any lint finding at error level. A warning is a signal, not a refusal. */
function hasLintError(flags: unknown): boolean {
  if (!Array.isArray(flags)) return false
  return flags.some((f) => (f as { level?: string } | null)?.level === 'error')
}

export function autoApprovable(
  row: AutoApprovableRow,
  settings: AutoApproveSettings,
): boolean {
  if (!settings.enabled) return false
  // Only a row the pipeline has finished with and nobody has ruled on. An
  // approved row is done and a rejected one is a decision to leave alone.
  if (row.status !== 'structured') return false
  if (!row.verified) return false
  if (row.category_id === null) return false
  if (settings.needsAnswer && !row.answer) return false
  if (verificationBlocked(row.flags)) return false
  return !hasLintError(row.flags)
}

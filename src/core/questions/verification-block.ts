// Findings that keep a row out of the verified lane whatever the wave says.
//
// The verification wave is a model reading two pictures, and on one live run
// of ten questions it called all ten a match with an empty diff at 0.95-0.97
// confidence. Five of those ten were showing a figure the DETERMINISTIC guard
// had already objected to on colour: a circle filled where only a lens should
// be, a cross shaded through its own centre, a universe rectangle missing its
// right edge. The reviewer saw it at a glance.
//
// So where a measurement and a model disagree about the one thing these
// questions turn on, the measurement wins and the row goes to a person. The
// cost is a reviewer's minute on a figure that may be fine; the cost of the
// other reading is a confidently green row showing a student the wrong shape.
//
// Deliberately narrow. Only findings that are deterministic AND about content
// belong here. Ink drift is neither — the guard is known to object to a
// faithful redraw over an endpoint that moved — so it stays a signal.
//
// Pure, so the list is argued about in one place and asserted offline.
import { REPAIRABLE_CODES } from '@/core/questions/structural-objections'

// `gen_colour_unresolved` is the guard's colour objection. The rest are the
// structural findings a re-read is asked to fix: while one of them stands, the
// row is showing a layout our own measurements say is wrong, and marking it
// verified on a model's say-so is the exact trade this file exists to refuse.
const BLOCKING = new Set([
  'gen_colour_unresolved',
  ...Object.keys(REPAIRABLE_CODES),
])

/** Whether anything on the row forbids marking it verified. */
export function verificationBlocked(flags: unknown): boolean {
  if (!Array.isArray(flags)) return false
  return flags.some((f) => BLOCKING.has((f as { code?: string })?.code ?? ''))
}

// What a repair round tells the model about the read it is replacing.
//
// A repair used to be a blind re-read: the same crop, the same prompt, the same
// forced tool, at temperature zero or with no sampling at all. The only thing
// that changed between the read that failed verification and the "repair" was
// the cache key. The second read came back the same, the wave reached the same
// verdict, and the row spent both repairs — and four paid calls — learning
// nothing. The log shows it plainly: one division scheme mismatched three times
// in a row, and two figure rows never converged.
//
// So the verifier's findings now ride along in the user turn, AFTER the crop
// and the hint, as a checklist to test against the picture. They are a hint and
// not a source: a verifier can be wrong, and a model that "fixes" a difference
// by writing what the checklist says rather than what the page shows would be
// inventing content, which is the one thing the recreation must never do. The
// prompt says so in as many words.
//
// Pure, and in core, because the worker submits the request and the eval pins
// its shape.

/** How many findings are worth relaying. Past this the verdict is describing
 *  a read that went wrong wholesale, and a fresh read needs no list. */
const MAX_NOTES = 8
const MAX_NOTE_LENGTH = 300

/**
 * The critical findings of the last verdict, as lines the prompt can carry.
 *
 * Only critical differences are relayed: a minor one never triggers a repair,
 * and a difference the verifier could not describe carries nothing to test.
 * Returns null when there is nothing worth saying, so the caller sends the
 * request exactly as a first read.
 */
export function repairNotesFrom(verifyDiff: unknown): string | null {
  if (!Array.isArray(verifyDiff)) return null
  const lines: string[] = []
  for (const entry of verifyDiff) {
    if (!entry || typeof entry !== 'object') continue
    const d = entry as { field?: unknown; severity?: unknown; note?: unknown }
    if (d.severity !== 'critical') continue
    const note = typeof d.note === 'string' ? d.note.trim() : ''
    if (!note) continue
    const field = typeof d.field === 'string' && d.field ? d.field : 'other'
    lines.push(`- ${field}: ${note.slice(0, MAX_NOTE_LENGTH)}`)
    if (lines.length >= MAX_NOTES) break
  }
  return lines.length ? lines.join('\n') : null
}

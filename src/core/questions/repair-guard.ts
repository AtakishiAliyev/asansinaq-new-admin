// Keeping the best version a repair produced, not the last one.
//
// A repair round re-reads the crop and overwrites the row. Until this existed
// that was unconditional, so a second read that came back WORSE replaced a
// better one — and the evidence that it had been better was a confidence score
// that got overwritten in the same update. The regression that motivated it:
// a geometry figure lost its congruence marks on a repair, and the row ended up
// carrying a figure strictly worse than the one the repair was meant to fix.
//
// The comparison cannot happen at extraction time, because the quality of a
// read is only known once the verification wave has ruled on it. So the version
// being replaced is parked on the row and this decides, after the verdict,
// which of the two survives.
//
// Pure and in core: the rule is a comparison, and it is the kind of rule that
// should be assertable without a database.

/** What is kept about a version so it can be restored and compared. */
export interface StoredVersion {
  stem: string | null
  options: unknown
  figures: unknown
  /** The verify confidence this version earned, or null if never verified. */
  verify_confidence: number | null
  verify_diff: unknown
  /** Whether that verdict called it a match. */
  verified: boolean
}

export interface RepairDecision {
  /** True when the new version stands; false when the parked one is restored. */
  keepNew: boolean
  reason: string
}

/**
 * Which version survives a repair round.
 *
 * Ties go to the NEW version. A repair is prompted by a real difference the
 * wave found, and an equal score means the second read is at least as good
 * while having been produced in response to that difference. Only a strictly
 * lower score is treated as a regression.
 *
 * A version that was never verified cannot lose: there is nothing to compare
 * it against, and refusing to store a read because its predecessor has no score
 * would strand the row.
 */
export function decideRepair(
  previous: StoredVersion | null,
  next: { verify_confidence: number | null; verified: boolean },
): RepairDecision {
  if (!previous) return { keepNew: true, reason: 'nothing parked to compare against' }
  if (previous.verify_confidence === null) {
    return { keepNew: true, reason: 'the previous version was never scored' }
  }
  if (next.verify_confidence === null) {
    return {
      keepNew: false,
      reason: `the repair produced no score to beat ${previous.verify_confidence.toFixed(2)}`,
    }
  }
  // A verified version outranks an unverified one whatever the numbers say:
  // confidence is how sure the comparison is, not how good the question is, and
  // a confident "this differs" must not beat a less confident "this matches".
  if (previous.verified && !next.verified) {
    return {
      keepNew: false,
      reason: 'the previous version matched the original and the repair did not',
    }
  }
  if (!previous.verified && next.verified) {
    return { keepNew: true, reason: 'the repair matches the original and the previous did not' }
  }
  if (next.verify_confidence >= previous.verify_confidence) {
    return {
      keepNew: true,
      reason: `repair scored ${next.verify_confidence.toFixed(2)} against ${previous.verify_confidence.toFixed(2)}`,
    }
  }
  return {
    keepNew: false,
    reason: `repair scored ${next.verify_confidence.toFixed(2)}, worse than ${previous.verify_confidence.toFixed(2)}`,
  }
}

/** The parked version, read defensively out of a jsonb column. */
export function parseStoredVersion(value: unknown): StoredVersion | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  // `figures` may legitimately be null, so presence is judged on the marker
  // fields that a parked version always carries.
  if (!('verify_confidence' in v) || !('verified' in v)) return null
  return {
    stem: typeof v.stem === 'string' ? v.stem : null,
    options: v.options ?? null,
    figures: v.figures ?? null,
    verify_confidence:
      typeof v.verify_confidence === 'number' ? v.verify_confidence : null,
    verify_diff: v.verify_diff ?? null,
    verified: v.verified === true,
  }
}

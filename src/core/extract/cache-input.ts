// What the extract cache key is computed from.
//
// Pure, and in core rather than in the worker, for two reasons. It has to be
// byte-identical everywhere a key is computed — a worker and a function that
// disagree about the shape do not share a cache, they each keep their own and
// the bill doubles quietly. And it has to be assertable offline: the worker
// module that used to hold it also loads the worker's env, so pinning it in the
// eval would have meant the free, offline gate demanding a service-role key.
//
// Everything that could change the answer belongs here. Everything that could
// not belongs out, or an unchanged re-run stops being free.

/** The row fields the read depends on. Structural on purpose: core does not
 *  import the worker's database types, and a narrower shape is easier to pass
 *  from a test than a whole row. */
import { repairNotesFrom } from '@/core/extract/repair-notes'

export interface CacheInputRow {
  q_no: number | null
  figure_kind: string | null
  text_layer: string | null
  test_no: number | null
  /** Which repair attempt this is. Zero for a first read. */
  repair_round: number
  /** The last verdict's differences, relayed to the model on a repair round. */
  verify_diff?: unknown
}

export function extractCacheInput(
  row: CacheInputRow,
  crop: { image: string; mime: string },
  categoryIds: number[],
): unknown {
  return {
    image: crop.image,
    mime: crop.mime,
    hasFigure: row.figure_kind !== 'none',
    hint: row.text_layer ?? null,
    testNo: row.test_no ?? null,
    expectedNumber: row.q_no,
    categoryIds,
    // A repair re-reads a crop that has already been read, with the same
    // prompt. Without this it is the most perfect cache hit in the system: the
    // "repaired" question comes back byte-identical to the one that failed
    // verification, the wave compares the same output to the same crop, reaches
    // the same verdict, and the row spends both of its repairs having changed
    // nothing — while every log line reads like the loop is working.
    repairRound: row.repair_round,
    // What the repair was TOLD is part of what it was asked. Two repairs of the
    // same round with different findings are different requests.
    repairNotes: repairNotesFor(row),
  }
}

/** The notes a repair round sends, or null for a first read. One place, so the
 *  request and the cache key cannot disagree about what was sent. */
export function repairNotesFor(row: Pick<CacheInputRow, 'repair_round' | 'verify_diff'>): string | null {
  return row.repair_round > 0 ? repairNotesFrom(row.verify_diff) : null
}

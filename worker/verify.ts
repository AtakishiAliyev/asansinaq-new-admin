// The verification wave.
//
// One question, two pictures: the crop the model read, and our rendering of
// what it produced. The comparison the model is asked to make is between two
// IMAGES, which it is good at — not between an image and a JSON object, which
// makes it hold two representations at once and report on both.
//
// This is the layer that replaced the hint-free second read. That layer earned
// `verified` by agreement between two independent reads of the same crop; this
// one has to be strictly stronger, not merely cheaper, because a wave that
// agrees with everything is indistinguishable from one that works and fails
// silently — rows arrive marked verified, auto-approve passes them, and nobody
// looks again. `scripts/verify-smoke.ts` exists to keep that honest.
import {
  buildVerifyRequest,
  describeFigure,
  EMIT_VERDICT_TOOL_NAME,
  parseVerdict,
  type Verdict,
} from '@/core/extract/verify-request'
import type { ExtractedQuestion } from '@/core/questions/extraction'
import type { Db, QuestionRow } from './db.ts'
import { config } from './config.ts'
import { downloadCrop } from './extract.ts'
import { fetchOptionImages, renderQuestion } from './render-question.ts'
import type { BatchItem } from './batch.ts'

export const VERIFY_OP = 'verify_anthropic'

/** `v<id>` — distinct from the extract wave's `q<id>` so a stray result from
 *  one wave can never be applied as the other's. */
export const verifyCustomId = (id: number): string => `v${id}`
export const idFromVerifyCustomId = (customId: string): number | null => {
  const m = /^v(\d+)$/.exec(customId)
  return m?.[1] ? Number(m[1]) : null
}

/**
 * Build the comparison request for one row.
 *
 * Returns null when the crop cannot be downloaded — the same "dropped, not
 * failed" rule the extract wave uses, because an object mid-upload is not a
 * defect in the question.
 */
export async function verifyItemFor(
  db: Db,
  row: QuestionRow,
): Promise<BatchItem | null> {
  const crop = await downloadCrop(db, row)
  if (!crop) return null

  // Rebuilt from the ROW, not from the cached wire: what is verified has to be
  // what is stored. A row edited by a reviewer, or written by an older prompt
  // generation, must be compared as it now stands.
  const question: ExtractedQuestion = {
    numberSeen: row.q_no,
    stem: row.stem ?? '',
    options: (row.options ?? []) as unknown as ExtractedQuestion['options'],
    figures: (row.figures ?? null) as unknown as ExtractedQuestion['figures'],
    illegible: false,
    clipped: false,
    foreign: false,
    confidence: 1,
    warnings: [],
  }

  const images = await fetchOptionImages(db, question)
  const rendered = renderQuestion(question, images)
  const request = buildVerifyRequest({
    original: { image: crop.image, mime: crop.mime },
    recreation: { image: rendered.png.toString('base64') },
    figureClaims: describeFigure(question.figures),
  })

  return {
    customId: verifyCustomId(row.id),
    model: config.MODEL_VERIFY,
    params: request.params,
  }
}

export interface VerifyOutcome {
  verdict: Verdict
  /** True when the row was sent back for another read. */
  repairing: boolean
}

/**
 * Write a verdict onto a row.
 *
 * A non-match does NOT overwrite the question. The extract wave produced the
 * best reading it could, and replacing it with nothing would lose work; what a
 * failed verification changes is the row's STANDING — unverified, diffed, and
 * in the review lane where a person decides.
 */
export async function applyVerdict(
  db: Db,
  row: QuestionRow,
  verdict: Verdict,
): Promise<VerifyOutcome> {
  const critical = verdict.differences.filter((d) => d.severity === 'critical')
  // Another read is only worth paying for when there is a concrete, critical
  // difference to feed back. A minor difference, or a low-confidence pass with
  // nothing named, is a reviewer's call rather than a second attempt.
  const repairing = !verdict.matches && critical.length > 0 && row.repair_round < MAX_REPAIRS

  const flags = [
    ...((row.flags ?? []) as { level: string; code: string; message: string }[]).filter(
      (f) => f.code !== 'verify_mismatch' && f.code !== 'verify_low_confidence',
    ),
  ]
  if (!verdict.matches) {
    flags.push({
      level: critical.length ? 'error' : 'warning',
      code: 'verify_mismatch',
      message: `Yenidən yaradılmış sual orijinaldan fərqlənir: ${verdict.differences
        .map((d) => `${d.field} — ${d.note}`)
        .join('; ')
        .slice(0, 500)}`,
    })
  } else if (verdict.confidence < LOW_CONFIDENCE) {
    flags.push({
      level: 'warning',
      code: 'verify_low_confidence',
      message: `Müqayisə uyğun saydı, amma əmin deyil (${verdict.confidence.toFixed(2)}) — gözlə yoxlayın`,
    })
  }

  await db
    .from('questions')
    .update({
      // `verified` drives the generated needs_attention column, so a row that
      // passes leaves the Diqqət lane without anything else being touched.
      verified: verdict.matches && verdict.confidence >= LOW_CONFIDENCE,
      verify_confidence: clamp01(verdict.confidence),
      verify_diff: verdict.differences as never,
      verified_at: new Date().toISOString(),
      flags: flags as never,
      ...(repairing
        ? {
            repair_round: row.repair_round + 1,
            queued_at: new Date().toISOString(),
            verified_at: null,
          }
        : {}),
    })
    .eq('id', row.id)

  return { verdict, repairing }
}

/** At most two. A third read of a crop that has already been read twice the
 *  same way is spending money to reach the same answer. */
export const MAX_REPAIRS = 2

/** Below this a "match" is not trusted enough to leave the review lane. */
export const LOW_CONFIDENCE = 0.7

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n)

export { EMIT_VERDICT_TOOL_NAME, parseVerdict }

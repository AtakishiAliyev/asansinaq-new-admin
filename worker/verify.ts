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
  EMIT_VERDICT_TOOL_NAME,
  parseVerdict,
  type Verdict,
} from '@/core/extract/verify-request'
import type { ExtractedQuestion } from '@/core/questions/extraction'
import { decideRepair, parseStoredVersion } from '@/core/questions/repair-guard'
import { reproductionBlamed } from '@/core/questions/verdict-blame'
import { structuralObjections } from '@/core/questions/structural-objections'
import { verificationBlocked } from '@/core/questions/verification-block'
import {
  autoApprovable,
  type AutoApproveSettings,
} from '@/core/questions/auto-approve'
import { MAX_GEN_EDITS } from '@/core/figures/gen-policy'
import type { FigureDoc, ImageFig } from '@/core/figures/figspec'
import { editProviderFor, editUntilBetter } from './figure-edit.ts'
import type { Flag } from '@/core/questions/lint'
import type { Db, QuestionRow } from './db.ts'
import { config } from './config.ts'
import { downloadCrop } from './extract.ts'
import { fetchOptionImages } from './render-question.ts'
import { verificationEvidence } from './verify-evidence.ts'
import type { BatchItem } from './batch.ts'

export const VERIFY_OP = 'verify_anthropic'

/** `v<id>` — distinct from the extract wave's `q<id>` so a stray result from
 *  one wave can never be applied as the other's. */
const verifyCustomId = (id: number): string => `v${id}`
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
  return {
    customId: verifyCustomId(row.id),
    model: config.MODEL_VERIFY,
    params: buildVerifyRequest(
      // The model-width copy, as in extraction: the comparison is about the
      // question, not the pixels, and the cut behind the render is full size.
      verificationEvidence(
        { image: crop.forModel.image, mime: crop.forModel.mime },
        question,
        images,
      ),
    ).params,
  }
}

export interface VerifyOutcome {
  verdict: Verdict
  /** True when the row was sent back for another read. */
  repairing: boolean
  /** True when the row cleared every automatic check and was approved by rule. */
  autoApproved?: boolean
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
  autoApprove: AutoApproveSettings = { enabled: false, needsAnswer: true },
): Promise<VerifyOutcome> {
  // The wave's own critical findings, plus the deterministic ones it did not
  // make. Merged HERE, once, so the repair decision, the stored diff and the
  // notes the next read is given all see the same list — a second path would
  // be a second thing to keep in step.
  const structural = structuralObjections(row.flags)
  const differences = [...verdict.differences, ...structural]
  const critical = differences.filter((d) => d.severity === 'critical')

  // A complaint about the drawing, while the drawing on show is a
  // reproduction, is a complaint about the reproduction. Re-reading the crop
  // cannot answer it. What can: handing the cut, the drawing and the complaint
  // back to an image model as an edit, up to MAX_GEN_EDITS times — and past
  // that, dropping the redraw so the cut takes its place. Either way the wave
  // rules again next pass on what the row now shows — see verdict-blame.ts.
  const blamed = verdict.matches
    ? []
    : reproductionBlamed(row.figures, verdict.differences)
  if (blamed.length) {
    const doc = row.figures as unknown as FigureDoc
    // The WAVE's findings only. A structural objection is about a typeset spec
    // — a rule in the wrong place, two partial products in one column — and an
    // image model handed that as a brief has nothing it can do with it.
    const why = verdict.differences
      .filter((d) => d.severity === 'critical')
      .map((d) => d.note.trim())
      .filter(Boolean)
      .join('; ')
      .slice(0, 400)
    const notes: string[] = []
    const items: FigureDoc['items'] = []
    /** Drawings this verdict replaces or discards. Deleted only after the row
     *  no longer names them — see the note at the removal. */
    const superseded: string[] = []
    for (const [index, item] of doc.items.entries()) {
      if (!blamed.includes(index) || item.kind !== 'image') {
        items.push(item)
        continue
      }
      const figure = item as ImageFig
      const round = figure.genRound ?? 0
      const attempts = figure.genEditAttempts ?? 0
      const edit =
        attempts < MAX_GEN_EDITS && editProviderFor(attempts)
          ? await editUntilBetter(
              db,
              row,
              index,
              figure,
              why || 'the reproduction differs from the original figure',
            )
          : null
      if (edit?.path) {
        if (figure.genSrc && figure.genSrc !== edit.path)
          superseded.push(figure.genSrc)
        const { genRejected: _cleared, ...rest } = figure
        items.push({
          ...rest,
          genSrc: edit.path,
          genProvider: edit.provider,
          genRound: round + 1,
          genEditAttempts: edit.attempts,
          ...(edit.rejection ? { genRejected: edit.rejection } : {}),
        })
        notes.push(
          `Fiqur ${index + 1}: yoxlayıcının qeydinə görə ${edit.provider} ilə düzəldildi (${round + 1}. cəhd)` +
            (edit.rejection ? `; qoruyucu etiraz etdi: ${edit.rejection}` : ''),
        )
        continue
      }
      // No edit possible, or the last one is spent: the cut is the figure.
      if (figure.genSrc) superseded.push(figure.genSrc)
      const { genSrc: _dropped, genProvider: _who, ...rest } = figure
      items.push({
        ...rest,
        ...(edit ? { genEditAttempts: edit.attempts } : {}),
        genRejected: `Yoxlayıcı rədd etdi: ${why || 'səbəb bildirilmədi'}`,
      })
      notes.push(
        `Fiqur ${index + 1}: təkrar çəkiliş atıldı, kəsim göstərilir` +
          (edit?.failure
            ? ` (${edit.failure})`
            : round >= MAX_GEN_EDITS
              ? ` (${MAX_GEN_EDITS} düzəliş cəhdi bitdi)`
              : ''),
      )
    }
    const edited = items.some(
      (it, i) =>
        blamed.includes(i) &&
        it.kind === 'image' &&
        Boolean((it as ImageFig).genSrc),
    )
    const kept = ((row.flags ?? []) as unknown as Flag[]).filter(
      (f) =>
        ![
          'verify_mismatch',
          'verify_low_confidence',
          'gen_unverified',
          'gen_rejected_by_verifier',
          'gen_edited',
        ].includes(f.code),
    )
    await db
      .from('questions')
      .update({
        figures: { ...doc, items } as never,
        flags: [
          ...kept,
          {
            level: 'warning',
            code: edited ? 'gen_edited' : 'gen_rejected_by_verifier',
            message:
              `${notes.join(' · ')} — yoxlayıcı: ${why || 'səbəb bildirilmədi'}`.slice(
                0,
                500,
              ),
          },
        ] as never,
        verified: false,
        verify_confidence: clamp01(verdict.confidence),
        verify_diff: differences as never,
        // Unruled again on purpose: the wave has judged the previous drawing,
        // and what the row shows now is a different picture.
        verified_at: null,
        prev_version: null,
      })
      .eq('id', row.id)
    // Only now, with the row written and prev_version cleared: nothing can
    // roll back to these any more. Before this was done, every edit round
    // left its predecessor in the bucket — on the first measured run those
    // superseded drawings were the largest class of orphan by size, 66 MB of
    // the 124 the bucket was carrying for nothing. Best effort: a picture that
    // outlives its row costs storage, a failed delete that undid the verdict
    // would cost the work.
    if (superseded.length) {
      const { error } = await db.storage
        .from('question-crops')
        .remove(superseded)
      if (error)
        console.warn(
          `[q${row.id}] superseded drawing(s) not removed: ${error.message}`,
        )
    }
    return { verdict, repairing: false }
  }

  // Another read is only worth paying for when there is a concrete, critical
  // difference to feed back. A minor difference, or a low-confidence pass with
  // nothing named, is a reviewer's call rather than a second attempt.
  // A structural objection is reason enough on its own. The wave called the
  // three questions that prompted this a match while our own measurements said
  // the layout was wrong on every one of them, so waiting for it to disagree
  // is waiting for the party that already got it wrong.
  const repairing =
    (!verdict.matches || structural.length > 0) &&
    critical.length > 0 &&
    row.repair_round < MAX_REPAIRS

  const flags = [
    ...(
      (row.flags ?? []) as { level: string; code: string; message: string }[]
    ).filter(
      (f) => f.code !== 'verify_mismatch' && f.code !== 'verify_low_confidence',
    ),
  ]
  if (!verdict.matches) {
    flags.push({
      level: critical.length ? 'error' : 'warning',
      code: 'verify_mismatch',
      message: `Yenidən yaradılmış sual orijinaldan fərqlənir: ${verdict.differences
        // A verdict can name a difference and describe none. Said plainly,
        // because "figure — " reads as a truncation rather than as the model
        // having nothing to say.
        .map((d) => `${d.field} — ${d.note.trim() || 'səbəb bildirilmədi'}`)
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

  // A repair round parked the version it replaced. Now that this one has been
  // scored, the better of the two wins — and a repair that came back worse is
  // rolled back rather than kept because it happened to be last.
  const parked = parseStoredVersion(row.prev_version)
  const decision = decideRepair(parked, {
    verify_confidence: clamp01(verdict.confidence),
    verified: verdict.matches && verdict.confidence >= LOW_CONFIDENCE,
  })
  if (parked && !decision.keepNew) {
    // The parked version's OWN lint comes back with its content. Without this
    // the row carried one version's figures under another's flags: live, a row
    // was restored with `n^2/n` in the divisor and an empty quotient while
    // showing the clean lint of the repair that had just been discarded, so
    // nothing objected to it and nothing could repair it.
    //
    // A version parked before flags were parked has none; there the flags in
    // hand are the best available and are left alone.
    const restored = Array.isArray(parked.flags)
      ? (parked.flags as { level: string; code: string; message: string }[]).filter(
          (f) => f.code !== 'repair_rejected',
        )
      : flags
    flags.length = 0
    flags.push(...restored)
    flags.push({
      level: 'warning',
      code: 'repair_rejected',
      message: `Təkrar oxunuş daha pis çıxdı, əvvəlki versiya saxlanıldı (${decision.reason})`,
    })
    await db
      .from('questions')
      .update({
        stem: parked.stem,
        options: parked.options as never,
        figures: parked.figures as never,
        verified: parked.verified,
        verify_confidence: parked.verify_confidence,
        verify_diff: parked.verify_diff as never,
        verified_at: new Date().toISOString(),
        flags: flags as never,
        prev_version: null,
      })
      .eq('id', row.id)
    // No further repair: the round that just ran produced something worse, and
    // spending another on the same crop is how a row loops until its budget is
    // gone.
    return { verdict, repairing: false }
  }

  const verified =
    verdict.matches &&
    verdict.confidence >= LOW_CONFIDENCE &&
    !verificationBlocked(row.flags)

  await db
    .from('questions')
    .update({
      prev_version: null,
      // `verified` drives the generated needs_attention column, so a row that
      // passes leaves the Diqqət lane without anything else being touched.
      verified,
      verify_confidence: clamp01(verdict.confidence),
      verify_diff: differences as never,
      verified_at: new Date().toISOString(),
      flags: flags as never,
      // `queued_at` is deliberately NOT set here. The caller still holds the
      // claim and the batch handle, and clearing those is `finish`, which nulls
      // queued_at along with them — so a re-queue written now is erased a few
      // lines later and the row falls back to the verify wave to be compared
      // against unchanged, forever. The caller owns the claim lifecycle, so the
      // caller re-queues, after it has let go.
      ...(repairing
        ? { repair_round: row.repair_round + 1, verified_at: null }
        : {}),
    })
    .eq('id', row.id)

  // Approved by rule, on the row as it now stands: this verdict's `verified`,
  // this verdict's flags, and the answer and category the row already carried.
  // A second update rather than one, because the first is what a reviewer's
  // Diqqət queue is computed from and it must land whether or not this fires.
  if (
    !repairing &&
    autoApprovable(
      {
        status: row.status,
        verified,
        answer: row.answer,
        category_id: row.category_id,
        flags,
        reviewed_at: row.reviewed_at,
      },
      autoApprove,
    )
  ) {
    const { error } = await db
      .from('questions')
      .update({
        status: 'approved',
        auto_approved: true,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', row.id)
      // Only from the state this verdict just wrote. Between the two updates a
      // reviewer may have ruled on the row by hand, and a rule must never
      // overwrite a person.
      .eq('status', 'structured')
    if (error)
      console.warn(`[q${row.id}] auto-approve failed: ${error.message}`)
    else return { verdict, repairing, autoApproved: true }
  }

  return { verdict, repairing }
}

/** At most two. A third read of a crop that has already been read twice the
 *  same way is spending money to reach the same answer. */
const MAX_REPAIRS = 2

/** Below this a "match" is not trusted enough to leave the review lane. */
const LOW_CONFIDENCE = 0.7

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n)

export { EMIT_VERDICT_TOOL_NAME, parseVerdict }

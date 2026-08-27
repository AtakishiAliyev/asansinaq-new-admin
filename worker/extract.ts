// One question: crop in, row out.
//
// Split in two because a batch is submitted at one moment and answered at
// another, possibly on the other side of a restart. `requestFor` is everything
// that happens before submission; `applyResult` is everything that happens
// after, and it must not depend on anything the submitting process held in
// memory. The only thing carried between them is the batch handle on the row.
import { extractCacheInput } from '@/core/extract/cache-input'
import { PROMPT_VERSION } from '@/core/extract/prompts'
import {
  buildAnthropicExtract,
  type AnthropicRequest,
} from '@/core/extract/request-anthropic'
import { wireToQuestion } from '@/core/questions/extraction'
import { rerouteAllToCut, rerouteIneligible } from '@/core/figures/kind-eligibility'
import type { StoredVersion } from '@/core/questions/repair-guard'
import type { Flag } from '@/core/questions/lint'
import { buildRowPayload } from '@/core/questions/row-payload'
import type { Db, QuestionRow } from './db.ts'
import { answerFor, type BookContext } from './book-context.ts'
import { modelFor } from './models.ts'
import { attachFigureImages, attachOptionImages } from './option-images.ts'

/** A verdict a reviewer reached outranks anything produced here. */
const REVIEWED = new Set(['approved', 'rejected'])

export const EXTRACT_OP = 'extract_anthropic'

/** `q<id>` — results come back unordered and are matched by this, never by
 *  position, so it has to survive a round trip through the provider. */
export const customIdFor = (id: number): string => `q${id}`
export const idFromCustomId = (customId: string): number | null => {
  const m = /^q(\d+)$/.exec(customId)
  return m?.[1] ? Number(m[1]) : null
}

export async function downloadCrop(
  db: Db,
  row: QuestionRow,
): Promise<{ image: string; mime: 'image/png' | 'image/jpeg' } | null> {
  const { data, error } = await db.storage
    .from('question-crops')
    .download(row.crop_path)
  // Dropped, not failed: the object may be mid-upload, and marking the question
  // failed would need a second pass to undo.
  if (error || !data) return null
  const image = Buffer.from(await data.arrayBuffer()).toString('base64')
  const mime = row.crop_mime === 'image/jpeg' ? 'image/jpeg' : 'image/png'
  return { image, mime }
}

export function requestFor(
  row: QuestionRow,
  crop: { image: string; mime: 'image/png' | 'image/jpeg' },
  context: BookContext,
): AnthropicRequest {
  return buildAnthropicExtract({
    image: crop.image,
    mime: crop.mime,
    // Colour is no longer a separate lane. Every figure is attempted as vector
    // and flagged for review if the DSL cannot hold it; nothing routes to an
    // image model unattended.
    hasFigure: row.figure_kind !== 'none',
    textLayerHint: row.text_layer ?? undefined,
    testNo: row.test_no ?? undefined,
    expectedNumber: row.q_no,
    categories: context.categories,
  })
}

/** The cache key's input half — everything that could change the answer.
 *  The shape itself lives in core so every caller computes the same key. */
export function cacheInputFor(
  row: QuestionRow,
  crop: { image: string; mime: string },
  context: BookContext,
): unknown {
  return extractCacheInput(
    row,
    crop,
    context.categories.map((c) => c.id),
  )
}

export interface ApplyOutcome {
  status: 'structured' | 'failed'
  flags: Flag[]
}

export async function applyResult(
  db: Db,
  row: QuestionRow,
  context: BookContext,
  wire: Record<string, unknown>,
  crop: { image: string; mime: string } | null,
): Promise<ApplyOutcome> {
  const question = wireToQuestion(wire)

  // A kind that cannot hold its figure is REPLACED by a cut of the original,
  // not merely flagged. Leaving the spec in place is what made the last round
  // useless: the lint fired and the row still carried a venn drawn out of
  // rectangles. The prompt asks; this enforces.
  // On a `gen` book the kind is not consulted at all: every figure is cut from
  // the original and reproduced from that cut. See `rerouteAllToCut`.
  const genLane = context.figureLane === 'gen'
  const routed = question.figures
    ? genLane
      ? rerouteAllToCut(question.figures.items)
      : rerouteIneligible(question.figures.items)
    : { items: [], rerouted: [] }
  if (question.figures) question.figures = { ...question.figures, items: routed.items }
  // On a `gen` book every figure is rerouted BY POLICY, so flagging them would
  // put every figure question in the review queue and say nothing — the queue
  // is for rows that need a person, and "this book cuts its figures" does not.
  // A kind that could not hold its figure is still a finding.
  const routeFlags: Flag[] = genLane
    ? []
    : routed.rerouted.map((bad) => ({
        level: 'warning',
        code: 'figure_rerouted',
        message:
          `kind="${bad.kind}" bu fiqura uyğun deyil (${bad.reason}) — ` +
          'fiqur orijinaldan kəsildi',
      }))

  // Before the payload is built, not after: the option-empty lint reads
  // `image`, so cutting the pictures later would flag every picture option on
  // a question that is about to be complete.
  const cut = crop
    ? await attachOptionImages(db, row, crop, question.options)
    : { produced: 0, failed: 0, flags: [] }
  // Same reasoning, for a figure that declared itself a region rather than a
  // drawing. Before the payload is built, so the cut path is on the row.
  const figureCut = crop
    ? await attachFigureImages(db, row, crop, question, context.figureLane)
    : { produced: 0, failed: 0, flags: [] }

  // The rules live in core because the review screen writes this same row after
  // a single re-run, and two copies of them would drift.
  const payload = buildRowPayload(question, wire, {
    qNo: row.q_no,
    currentStatus: row.status,
    answerSource: row.answer_source,
    keyAnswer: answerFor(context, row.test_no, row.q_no),
    answerKeysRead: context.answerKeysRead,
    categoryIds: context.categories.map((c) => c.id),
    croppedOptionImages: cut.produced,
    cutFlags: [...cut.flags, ...figureCut.flags, ...routeFlags],
    model: modelFor(row.figure_kind !== 'none' ? 'figure' : 'text'),
    promptVersion: PROMPT_VERSION,
  })

  // On a repair round the version being replaced is parked, because whether the
  // replacement is an improvement cannot be known until the wave has ruled on
  // it. Without this a worse second read silently overwrites a better first one
  // and takes the evidence with it.
  const parked: StoredVersion | null =
    row.repair_round > 0
      ? {
          stem: row.stem,
          options: row.options,
          figures: row.figures,
          verify_confidence: row.verify_confidence,
          verify_diff: row.verify_diff,
          verified: row.verified === true,
        }
      : null

  const { error } = await db
    .from('questions')
    .update({
      ...(payload.update as Record<string, unknown>),
      ...(parked ? { prev_version: parked as never } : {}),
    } as never)
    .eq('id', row.id)
  if (error) throw new Error(`row ${row.id} not written: ${error.message}`)
  return { status: payload.status, flags: payload.flags }
}

/** A row the provider could not answer for. */
export async function markFailed(
  db: Db,
  row: QuestionRow,
  reason: string,
): Promise<void> {
  await db
    .from('questions')
    .update({
      status: REVIEWED.has(row.status) ? row.status : 'failed',
      verified: false,
      extraction_error: reason,
    })
    .eq('id', row.id)
}

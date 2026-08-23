// One question: crop in, row out.
//
// Split in two because a batch is submitted at one moment and answered at
// another, possibly on the other side of a restart. `requestFor` is everything
// that happens before submission; `applyResult` is everything that happens
// after, and it must not depend on anything the submitting process held in
// memory. The only thing carried between them is the batch handle on the row.
import { PROMPT_VERSION } from '@/core/extract/prompts'
import {
  buildAnthropicExtract,
  type AnthropicRequest,
} from '@/core/extract/request-anthropic'
import { wireToQuestion } from '@/core/questions/extraction'
import { lintQuestion, type Flag } from '@/core/questions/lint'
import type { Db, QuestionRow } from './db.ts'
import { answerFor, type BookContext } from './book-context.ts'
import { modelFor } from './models.ts'

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

/** The cache key's input half — everything that could change the answer. */
export function cacheInputFor(
  row: QuestionRow,
  crop: { image: string; mime: string },
  context: BookContext,
): unknown {
  return {
    image: crop.image,
    mime: crop.mime,
    hasFigure: row.figure_kind !== 'none',
    hint: row.text_layer ?? null,
    testNo: row.test_no ?? null,
    expectedNumber: row.q_no,
    categoryIds: context.categories.map((c) => c.id),
  }
}

function categoryFrom(
  wire: Record<string, unknown>,
  context: BookContext,
): { id: number | null; confidence: number | null } {
  const raw = wire.category_id
  const id = typeof raw === 'number' ? raw : null
  // An id the model invented would be filed silently and look exactly like a
  // real one, so anything not in this book's own tree is discarded.
  if (id === null || !context.categories.some((c) => c.id === id)) {
    return { id: null, confidence: null }
  }
  const confidence = wire.category_confidence
  return { id, confidence: typeof confidence === 'number' ? confidence : null }
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
): Promise<ApplyOutcome> {
  const question = wireToQuestion(wire)
  const flags = lintQuestion(question, row.q_no)

  const answer = answerFor(context, row.test_no, row.q_no)
  if (!answer) {
    flags.push(
      context.answerKeysRead
        ? {
            level: 'warning',
            code: 'answer_missing',
            message: 'Cavab yoxdur — cavab açarını idxal edin və ya əl ilə seçin',
          }
        : {
            level: 'warning',
            code: 'answer_key_unread',
            message:
              'Cavab açarı oxunmadı (şəbəkə xətası) — sual açarsız qaldı, yenidən çıxarın',
          },
    )
  }

  // Nothing at all was read. Not repairable and not reviewable — but a
  // stem-less question that HAS a diagram and five options is a real format in
  // these books, where the instruction is printed once above a group.
  const isEmptyRead =
    !question.stem.trim() &&
    !question.options.length &&
    !question.figures?.items.length

  if (isEmptyRead) {
    await db
      .from('questions')
      .update({
        status: REVIEWED.has(row.status) ? row.status : 'failed',
        flags: flags as never,
        verified: false,
        extraction_error:
          'Crop-dan heç nə oxunmadı — sərhədləri yenidən kəsin və ya əl ilə daxil edin',
      })
      .eq('id', row.id)
    return { status: 'failed', flags }
  }

  const category = categoryFrom(wire, context)
  const difficulty = wire.difficulty
  const model = modelFor(row.figure_kind !== 'none' ? 'figure' : 'text')

  const { error } = await db
    .from('questions')
    .update({
      status: REVIEWED.has(row.status) ? row.status : 'structured',
      // NULL, not '': the column forbids a blank string precisely so a missing
      // wording cannot be confused with a present empty one.
      stem: question.stem.trim() || null,
      options: question.options as never,
      figures: (question.figures ?? null) as never,
      ai_difficulty: typeof difficulty === 'number' ? difficulty : null,
      ...(row.answer_source !== 'reviewer' && answer
        ? { answer, answer_source: 'key' as const, answer_confidence: null }
        : {}),
      // A restructure of a book with no tree must not erase an existing
      // suggestion, so this is only written when a tree was actually sent.
      ...(context.categories.length
        ? {
            ai_category_id: category.id,
            ai_category_confidence: category.confidence,
          }
        : {}),
      model,
      prompt_version: PROMPT_VERSION,
      // Pipeline-only timestamp: throughput must not count approvals.
      structured_at: new Date().toISOString(),
      flags: flags as never,
      // There is no second opinion yet. Verification is its own batch wave and
      // it is not built, so every row lands unverified and therefore in the
      // Diqqət lane. Claiming otherwise here would auto-approve unread work.
      verified: false,
      extraction_error: null,
    })
    .eq('id', row.id)

  if (error) throw new Error(`row ${row.id} not written: ${error.message}`)
  return { status: 'structured', flags }
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

// What a read becomes, as a row.
//
// In core because two runtimes write this row and they must write it the same
// way: the worker after a batch, the review screen after a single re-run. The
// rules here are small and every one of them is a decision someone made after
// something went wrong — a reviewer's verdict overwritten, an answer replaced
// by a worse one, a category erased by a re-run that never asked for one. Two
// copies would keep one of those fixes and lose the other.
//
// Pure: it builds the payload and the flags. Writing it, and producing any
// images it refers to, belongs to the caller — that part is genuinely different
// per runtime.
import type { ExtractedQuestion } from '@/core/questions/extraction'
import { lintQuestion, type Flag } from '@/core/questions/lint'

/** Verdicts a person reached. Nothing the pipeline produces may overwrite one. */
const REVIEWED = new Set(['approved', 'rejected'])

export interface RowContext {
  /** The printed number, for the number-mismatch check. */
  qNo: number
  /** The row's status BEFORE this read. */
  currentStatus: string
  /** `answer_source` on the row, so a reviewer's answer is never replaced. */
  answerSource: string | null
  /** The answer from the printed key, or null. Never a model's opinion. */
  keyAnswer: string | null
  /**
   * False when the key FETCH failed. "No key imported" and "we could not read
   * the key" are different facts and only one of them is the book's.
   */
  answerKeysRead: boolean
  /** The tree that was sent. Empty means no category was asked for. */
  categoryIds: number[]
  /** How many option images were cut from the source crop, if any. */
  croppedOptionImages?: number
  /**
   * Findings from the cut itself — for instance that the option positions could
   * not be measured and the model's own boxes were used unchecked. They arrive
   * here rather than being written separately so a single row UPDATE carries
   * every flag the read produced.
   */
  cutFlags?: Flag[]
  model: string
  promptVersion: number
}

export interface RowPayload {
  status: 'structured' | 'failed'
  flags: Flag[]
  /** Ready to hand to an `update()`. */
  update: Record<string, unknown>
}

function categoryFrom(
  wire: Record<string, unknown>,
  categoryIds: number[],
): { id: number | null; confidence: number | null } {
  const raw = wire.category_id
  const id = typeof raw === 'number' ? raw : null
  // An id the model invented would be filed silently and look exactly like a
  // real one, so anything outside the tree that was sent is discarded.
  if (id === null || !categoryIds.includes(id)) return { id: null, confidence: null }
  const confidence = wire.category_confidence
  return { id, confidence: typeof confidence === 'number' ? confidence : null }
}

export function buildRowPayload(
  question: ExtractedQuestion,
  wire: Record<string, unknown>,
  context: RowContext,
): RowPayload {
  const flags = lintQuestion(question, context.qNo)

  if (!context.keyAnswer) {
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

  // A cut option is a FALLBACK, not the target state: it is a rectangle of the
  // scanned page and carries whatever the page carried — the source watermark,
  // a neighbour's edge. Warning rather than error, because the question is
  // usable and a reviewer can accept it; but warning is enough to keep
  // auto-approve away, which is the point.
  if (context.cutFlags?.length) flags.push(...context.cutFlags)

  if (context.croppedOptionImages) {
    flags.push({
      level: 'warning',
      code: 'option_image_cropped',
      message: `${context.croppedOptionImages} variant şəkli mənbədən kəsilib (su nişanı daşıya bilər) — DSL fiquru deyil, baxılmalıdır`,
    })
  }

  // Nothing at all was read: not repairable and not reviewable. But a stemless
  // question that HAS a diagram and five options is a real format in these
  // books, where the instruction is printed once above a group.
  const isEmptyRead =
    !question.stem.trim() &&
    !question.options.length &&
    !question.figures?.items.length

  if (isEmptyRead) {
    return {
      status: 'failed',
      flags,
      update: {
        status: REVIEWED.has(context.currentStatus) ? context.currentStatus : 'failed',
        flags,
        verified: false,
        extraction_error:
          'Crop-dan heç nə oxunmadı — sərhədləri yenidən kəsin və ya əl ilə daxil edin',
      },
    }
  }

  const category = categoryFrom(wire, context.categoryIds)
  const difficulty = wire.difficulty

  return {
    status: 'structured',
    flags,
    update: {
      status: REVIEWED.has(context.currentStatus) ? context.currentStatus : 'structured',
      // NULL, not '': the column forbids a blank string precisely so a missing
      // wording cannot be confused with a present empty one.
      stem: question.stem.trim() || null,
      options: question.options,
      figures: question.figures ?? null,
      ai_difficulty: typeof difficulty === 'number' ? difficulty : null,
      ...(context.answerSource !== 'reviewer' && context.keyAnswer
        ? {
            answer: context.keyAnswer,
            answer_source: 'key',
            answer_confidence: null,
          }
        : {}),
      // Only written when a tree was actually sent: a re-run of a book with no
      // categories must not erase the suggestion an earlier run made.
      ...(context.categoryIds.length
        ? {
            ai_category_id: category.id,
            ai_category_confidence: category.confidence,
          }
        : {}),
      model: context.model,
      prompt_version: context.promptVersion,
      // Pipeline-only timestamp: throughput must not count approvals.
      structured_at: new Date().toISOString(),
      flags,
      // There is no second opinion. Verification is its own batch wave; until
      // it exists every row lands unverified and therefore in the Diqqət lane,
      // because claiming otherwise would auto-approve unread work.
      verified: false,
      extraction_error: null,
    },
  }
}

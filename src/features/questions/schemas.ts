import { z } from 'zod'

// Wire shapes crossing the question-ops boundary, plus the row shape the list
// screens read back. The extract wire lived here too, for the browser
// re-extraction lane; that lane is gone and structuring is the worker's alone.

export const parseAnswerKeyResponseSchema = z.object({
  entries: z.array(
    z.object({
      // Which printed block, counting from 1. A book reuses a test number for
      // two blocks and only the position tells them apart; a scan has no
      // geometry to recover that from, so the model is asked for it.
      block: z.number().nullish(),
      test_no: z.number().nullish(),
      q_no: z.number(),
      answer: z.enum(['A', 'B', 'C', 'D', 'E']),
    }),
  ),
})

// The DB row (subset the client works with; mirrors public.questions).
export const questionRowSchema = z.object({
  id: z.number(),
  book_id: z.number(),
  page_number: z.number(),
  col: z.number(),
  q_no: z.number(),
  test_no: z.number().nullable(),
  crop_path: z.string(),
  crop_mime: z.string(),
  figure_kind: z.enum(['colored', 'rule', 'none']),
  is_scan: z.boolean(),
  text_layer: z.string().nullable(),
  status: z.enum(['cropped', 'structured', 'approved', 'rejected', 'failed']),
  stem: z.string().nullable(),
  options: z.unknown().nullable(),
  figures: z.unknown().nullable(),
  answer: z.string().nullable(),
  answer_source: z.string().nullable(),
  ai_category_id: z.number().nullable(),
  ai_category_confidence: z.number().nullable(),
  category_id: z.number().nullable(),
  ai_difficulty: z.number().nullable(),
  reviewer_difficulty: z.number().nullable(),
  model: z.string().nullable(),
  flags: z.unknown(),
  verified: z.boolean(),
  // Generated in Postgres, never written by the client. Required, not
  // defaulted: if the migration that adds it has not been pushed, the parse
  // must fail loudly rather than quietly report every question as clean.
  needs_attention: z.boolean(),
  extraction_error: z.string().nullable(),
  queued_at: z.string().nullable().default(null),
  claimed_at: z.string().nullable().default(null),
  // Read by the UI only to protect it: a row holding a batch handle has work
  // in flight that is already paid for, and deleting it throws the results
  // away without cancelling the charge.
  batch_id: z.string().nullable().default(null),
  attempts: z.number().default(0),
  auto_approved: z.boolean().default(false),
})

export type QuestionRow = z.infer<typeof questionRowSchema>

/** Natural-key string used to join crops, rows and UI selection. */
export function cropKey(c: {
  pageNumber: number
  col: number
  number: number
}): string {
  return `p${c.pageNumber}_c${c.col}_q${c.number}`
}

export function rowKey(r: {
  page_number: number
  col: number
  q_no: number
}): string {
  return `p${r.page_number}_c${r.col}_q${r.q_no}`
}

import { z } from 'zod'

// Wire shapes crossing the question-ops boundary. The extract wire stays
// loose on figures (core wireToQuestion normalizes them); everything the
// flow logic relies on is validated here.

export const wireOptionSchema = z.object({
  label: z.enum(['A', 'B', 'C', 'D', 'E']),
  tex: z.string().optional(),
  is_image: z.boolean().optional(),
  box: z.array(z.number()).length(4).optional(),
})

export const extractWireSchema = z
  .object({
    number_seen: z.number(),
    stem: z.string(),
    options: z.array(wireOptionSchema),
    figures: z.array(z.record(z.string(), z.unknown())).nullish(),
    illegible: z.boolean(),
    clipped: z.boolean().nullish(),
    foreign: z.boolean().nullish(),
    confidence: z.number(),
    difficulty: z.number().int().min(1).max(5).nullish(),
    warnings: z.array(z.string()).nullish(),
  })
  .loose()

export type ExtractWire = z.infer<typeof extractWireSchema>

export const extractResponseSchema = z.object({
  wire: extractWireSchema,
  model: z.string(),
  ms: z.number(),
})

export const redrawResponseSchema = z.object({
  image: z.string(),
  mime: z.string(),
  model: z.string(),
  ms: z.number(),
})

export const compareResponseSchema = z.object({
  match: z.boolean(),
  differences: z.array(z.string()).nullish(),
})

export const solveResponseSchema = z.object({
  answer: z.enum(['A', 'B', 'C', 'D', 'E']),
})

export const suggestCategoryResponseSchema = z.object({
  category_id: z.number().nullish(),
  // Clamped, not trusted: a model that answers 95 instead of 0.95 would fail
  // the ai_category_confidence CHECK (0..1) on update and throw away a
  // question we already paid to extract.
  confidence: z.number().min(0).max(1).catch(0),
})

export const parseAnswerKeyResponseSchema = z.object({
  entries: z.array(
    z.object({
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
  extraction_error: z.string().nullable(),
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

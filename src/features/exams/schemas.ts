import { z } from 'zod'
import type { FigureDoc } from '@/core/figures/figspec'
import type { RowOption } from '@/features/questions'

// PostgREST serialises `numeric` as a JSON number, but a coerce costs nothing
// and keeps a future string-encoded numeric from failing every parse.
const num = z.coerce.number()

export const NAVIGATION = ['free', 'linear'] as const
export const REVEAL = ['after_submit', 'never'] as const

export const templateSectionSchema = z.object({
  position: z.number().int(),
  subject_id: z.number().int(),
  question_count: z.number().int(),
  duration_seconds: z.number().int().nullable(),
  points_correct: num,
  penalty_ratio: num,
})
export type TemplateSection = z.infer<typeof templateSectionSchema>

export const templateSchema = z.object({
  id: z.number().int(),
  program_id: z.number().int(),
  name: z.string(),
  name_pattern: z.string(),
  duration_seconds: z.number().int(),
  navigation: z.enum(NAVIGATION),
  pause_on_exit: z.boolean(),
  allow_retake: z.boolean(),
  reveal_answers: z.enum(REVEAL),
  scoring_method: z.string(),
  base_score: num,
  min_score: num,
  sort_order: z.number().int(),
  archived_at: z.string().nullable(),
  sections: z.array(templateSectionSchema),
})
export type Template = z.infer<typeof templateSchema>

export const examListItemSchema = z.object({
  id: z.number().int(),
  program_id: z.number().int(),
  template_id: z.number().int(),
  seq: z.number().int(),
  title: z.string(),
  is_visible: z.boolean(),
  current_version_id: z.number().int().nullable(),
  draft_updated_at: z.string(),
  updated_at: z.string(),
  template: z.object({
    name: z.string(),
    sections: z.array(z.object({ question_count: z.number().int() })),
  }),
  current: z
    .object({ version_no: z.number().int(), published_at: z.string() })
    .nullable(),
  items: z.array(z.object({ count: z.number().int() })),
})
export type ExamListItem = z.infer<typeof examListItemSchema>

export const examDetailSchema = examListItemSchema
  .omit({ items: true, template: true })
  .extend({
    template: templateSchema,
  })
export type ExamDetail = z.infer<typeof examDetailSchema>

export const versionSchema = z.object({
  id: z.number().int(),
  version_no: z.number().int(),
  published_at: z.string(),
  question_count: z.number().int(),
  max_score: num,
  duration_seconds: z.number().int(),
})
export type ExamVersion = z.infer<typeof versionSchema>

export const draftRowSchema = z.object({
  section_position: z.number().int(),
  item_position: z.number().int(),
  question_id: z.number().int(),
  category_id: z.number().int().nullable(),
  difficulty: z.number().int().nullable(),
  status: z.string(),
  stem: z.string().nullable(),
  options: z.unknown(),
  answer: z.string().nullable(),
  figures: z.unknown(),
  usage_count: z.number().int(),
  changed_since_publish: z.boolean(),
})

export const searchRowSchema = z.object({
  id: z.number().int(),
  category_id: z.number().int().nullable(),
  difficulty: z.number().int().nullable(),
  stem: z.string().nullable(),
  options: z.unknown(),
  answer: z.string().nullable(),
  figures: z.unknown(),
  book_id: z.number().int().nullable(),
  page_number: z.number().int().nullable(),
  q_no: z.number().int().nullable(),
  usage_count: z.number().int(),
  in_exam: z.boolean(),
})

export const facetRowSchema = z.object({
  category_id: z.number().int().nullable(),
  difficulty: z.number().int().nullable(),
  n: z.coerce.number().int(),
})
export type FacetRow = z.infer<typeof facetRowSchema>

export const pickRowSchema = z.object({
  category_id: z.number().int().nullable(),
  difficulty: z.number().int().nullable(),
  question_id: z.number().int(),
})

/**
 * One question as the builder handles it, whether it came from the search
 * list or from the saved draft. The two RPCs return the bank's columns; this
 * is them parsed once, so no component narrows a jsonb column on its own.
 */
export interface BuilderQuestion {
  id: number
  categoryId: number | null
  difficulty: number | null
  stem: string
  options: RowOption[]
  answer: string | null
  figures: FigureDoc | null
  /** Other exams this question also sits in. */
  usageCount: number
  /** Present for draft slots only. */
  status?: string
  changedSincePublish?: boolean
  source?: { bookId: number | null; page: number | null; qNo: number | null }
}

export type FiguresFilter = 'any' | 'with' | 'without'

export interface SearchFilters {
  subjectId: number
  categoryIds: number[]
  difficulties: number[]
  figures: FiguresFilter
  search: string
  unusedOnly: boolean
  examId: number
}

// ── template form ───────────────────────────────────────────────────────────

export const templateSectionFormSchema = z.object({
  subject_id: z.number().int().positive('Fənn seçin'),
  question_count: z.number().int().min(1, 'Ən azı 1').max(500, 'Ən çox 500'),
  duration_minutes: z.number().int().positive().nullable(),
  points_correct: z.number().min(0, 'Mənfi ola bilməz'),
  penalty_ratio: z.number().min(0).max(1, '0 ilə 1 arasında'),
})

export const templateFormSchema = z.object({
  name: z.string().trim().min(1, 'Ad lazımdır'),
  name_pattern: z
    .string()
    .trim()
    .refine((v) => v.includes('{nn}'), 'Ad şablonunda {nn} olmalıdır'),
  duration_minutes: z.number().int().min(1, 'Ən azı 1 dəqiqə'),
  navigation: z.enum(NAVIGATION),
  pause_on_exit: z.boolean(),
  allow_retake: z.boolean(),
  reveal_answers: z.enum(REVEAL),
  base_score: z.number().min(0),
  min_score: z.number().min(0),
  sections: z
    .array(templateSectionFormSchema)
    .min(1, 'Ən azı bir bölmə lazımdır'),
})
export type TemplateFormValues = z.infer<typeof templateFormSchema>

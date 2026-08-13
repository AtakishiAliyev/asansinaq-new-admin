import { z } from 'zod'

export const programSchema = z.object({
  id: z.number(),
  name: z.string(),
  sort_order: z.number(),
})

export type Program = z.infer<typeof programSchema>

export const subjectSchema = z.object({
  id: z.number(),
  program_id: z.number(),
  name: z.string(),
  sort_order: z.number(),
  category_count: z.number().default(0),
})

export type Subject = z.infer<typeof subjectSchema>

export const categorySchema = z.object({
  id: z.number(),
  subject_id: z.number(),
  parent_id: z.number().nullable(),
  name: z.string(),
  sort_order: z.number(),
})

export type Category = z.infer<typeof categorySchema>

export interface CategoryNode extends Category {
  children: Category[]
}

export const nameFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Ad boş ola bilməz')
    .max(120, 'Ad çox uzundur'),
})

export type NameFormValues = z.infer<typeof nameFormSchema>

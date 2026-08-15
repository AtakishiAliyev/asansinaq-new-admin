import { z } from 'zod'

export const bookSchema = z.object({
  id: z.number(),
  title: z.string(),
  program_id: z.number(),
  subject_id: z.number().nullable(),
  tags: z.array(z.string()),
  note: z.string().nullable(),
  storage_path: z.string().nullable(),
  original_name: z.string(),
  file_size: z.number(),
  page_count: z.number().nullable(),
  content_hash: z.string().nullable(),
  worked_pages: z.array(z.number()),
  created_at: z.string(),
  programs: z.object({ name: z.string() }).nullable(),
  subjects: z.object({ name: z.string() }).nullable(),
  profiles: z.object({ full_name: z.string() }).nullable(),
})

export type Book = z.infer<typeof bookSchema>

export const bookFormSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Ad boş ola bilməz')
    .max(200, 'Ad çox uzundur'),
  program_id: z.number().positive('Proqram seçilməlidir'),
  subject_id: z.number().nullable(),
  tags: z
    .array(z.string().trim().min(1).max(40))
    .max(20, 'Ən çoxu 20 tag')
    .transform((tags) => [...new Set(tags)]),
  note: z.string().trim().max(2000, 'Qeyd çox uzundur'),
})

export type BookFormValues = z.infer<typeof bookFormSchema>

/** Strips extension and separators from a filename for the title default. */
export function titleFromFilename(name: string): string {
  return name
    .replace(/\.pdf$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
}

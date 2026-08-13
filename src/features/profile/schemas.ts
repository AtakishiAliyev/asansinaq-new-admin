import { z } from 'zod'

export const profileSchema = z.object({
  id: z.uuid(),
  full_name: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
})

export type Profile = z.infer<typeof profileSchema>

export const profileFormSchema = z.object({
  full_name: z
    .string()
    .trim()
    .min(1, 'Ad boş ola bilməz')
    .max(120, 'Ad 120 simvoldan uzun ola bilməz'),
})

export type ProfileFormValues = z.infer<typeof profileFormSchema>

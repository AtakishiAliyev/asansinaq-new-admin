import { z } from 'zod'

export const emailFormSchema = z.object({
  email: z.email('Düzgün email ünvanı daxil edin'),
})

export type EmailFormValues = z.infer<typeof emailFormSchema>

export const OTP_LENGTH = 6

export const otpFormSchema = z.object({
  token: z
    .string()
    .regex(/^\d+$/, 'Kod yalnız rəqəmlərdən ibarətdir')
    .length(OTP_LENGTH, `Kod ${OTP_LENGTH} rəqəmdən ibarətdir`),
})

export type OtpFormValues = z.infer<typeof otpFormSchema>

export const isAdminSchema = z.boolean()

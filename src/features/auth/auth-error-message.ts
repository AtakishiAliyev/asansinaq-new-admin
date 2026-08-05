import { isAuthError } from '@supabase/supabase-js'
import { normalizeError } from '@/lib/errors'

// Supabase reports "this email has no account" and "signups are off" with the
// same code, because telling them apart would let anyone probe the allowlist.
// Both mean the same thing to us, so one message covers them.
const MESSAGES: Record<string, string> = {
  otp_disabled: 'Bu email admin siyahısında deyil.',
  otp_expired: 'Kodun vaxtı bitib və ya yanlışdır. Yeni kod istəyin.',
  over_email_send_rate_limit:
    'Çox sayda sorğu göndərildi. Bir neçə dəqiqə sonra yenidən cəhd edin.',
  over_request_rate_limit:
    'Çox sayda sorğu göndərildi. Bir neçə dəqiqə sonra yenidən cəhd edin.',
  validation_failed: 'Daxil edilən məlumat düzgün deyil.',
}

export function authErrorMessage(error: unknown): string {
  if (isAuthError(error) && error.code && error.code in MESSAGES) {
    return MESSAGES[error.code]
  }
  if (isAuthError(error)) {
    return 'Giriş alınmadı. Yenidən cəhd edin.'
  }
  return normalizeError(error).message
}

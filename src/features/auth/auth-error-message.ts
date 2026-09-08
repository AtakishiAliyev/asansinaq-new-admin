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
    return MESSAGES[error.code]!
  }
  // A 500 with no code is the mail send failing, and it says so, because the
  // generic retry line sent someone hunting through Supabase for a fault that
  // was in the email provider. It happened the day a second admin was added:
  // the SMTP sender was still Resend's `onboarding@resend.dev`, which their
  // docs restrict to the Resend account's OWN address, so the first admin
  // received codes and the second never could. Retrying cannot fix that, and
  // telling someone to retry is worse than saying nothing.
  //
  // Safe to distinguish: a mail failure says nothing about whether the address
  // is on the allowlist, which is why `otp_disabled` above stays deliberately
  // vague and this does not.
  if (isAuthError(error) && error.status === 500) {
    return 'Email göndərilə bilmədi — göndərmə xidmətini yoxlayın. Təkrar cəhd kömək etməyəcək.'
  }
  if (isAuthError(error)) {
    return 'Giriş alınmadı. Yenidən cəhd edin.'
  }
  return normalizeError(error).message
}

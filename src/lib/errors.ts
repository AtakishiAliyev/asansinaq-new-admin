import { isAuthError } from '@supabase/supabase-js'
import { isAxiosError } from 'axios'
import { ZodError } from 'zod'

export interface AppError {
  code: string
  message: string
  cause: unknown
}

interface PostgrestErrorShape {
  code: string
  message: string
  details: string | null
  hint: string | null
}

function isPostgrestError(error: unknown): error is PostgrestErrorShape {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'message' in error &&
    'details' in error &&
    'hint' in error
  )
}

// Raw server messages never reach users — they go into `cause` for logging.
export function normalizeError(error: unknown): AppError {
  if (error instanceof ZodError) {
    return {
      code: 'validation_error',
      message: 'Serverdən gözlənilməz cavab gəldi. Yenidən cəhd edin.',
      cause: error,
    }
  }
  if (isAuthError(error)) {
    return {
      code: error.code ?? 'auth_error',
      message: 'Giriş uğursuz oldu. Yenidən daxil olun.',
      cause: error,
    }
  }
  if (isAxiosError(error)) {
    return {
      code: error.code ?? 'network_error',
      message: 'Şəbəkə sorğusu alınmadı. Yenidən cəhd edin.',
      cause: error,
    }
  }
  if (isPostgrestError(error)) {
    return {
      code: error.code,
      message: 'Baza sorğusu alınmadı. Yenidən cəhd edin.',
      cause: error,
    }
  }
  return {
    code: 'unknown_error',
    message: 'Xəta baş verdi. Yenidən cəhd edin.',
    cause: error,
  }
}

/**
 * The underlying reason, for diagnostics the OPERATOR reads — the pipeline's
 * `extraction_error` column and its flags. Never for a toast.
 *
 * `normalizeError` exists so a user is never shown a raw server message, and
 * that rule holds. But a failure recorded against a question is a note to the
 * person debugging it, and "Baza sorğusu alınmadı" tells them nothing they can
 * act on: a payload over the bucket's limit, a violated constraint and a
 * revoked policy all read identically. This keeps the detail, and keeps it out
 * of the places users look.
 */
export function errorDetail(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (isPostgrestError(error)) {
    return [error.code, error.message, error.details, error.hint]
      .filter(Boolean)
      .join(' · ')
  }
  if (error && typeof error === 'object') {
    const o = error as { message?: unknown; error?: unknown; statusCode?: unknown }
    const parts = [o.statusCode, o.error, o.message].filter(
      (v) => typeof v === 'string' || typeof v === 'number',
    )
    if (parts.length) return parts.join(' · ')
    try {
      return JSON.stringify(error).slice(0, 300)
    } catch {
      return 'serialize edilə bilməyən xəta obyekti'
    }
  }
  return String(error ?? 'naməlum xəta')
}

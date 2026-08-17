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

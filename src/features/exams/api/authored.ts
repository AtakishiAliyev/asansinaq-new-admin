import { isPostgrestError, UserFacingError } from '@/lib/errors'

// Our exam functions refuse with messages written for the operator —
// `raise exception 'Bölmələr tam deyil: …'` arrives as P0001, a "not found"
// as P0002. Those are passed through as they are. Two constraint violations
// the builder can trip are given words of their own. Anything else stays a
// raw error for the global normaliser to hide.
export function authored(error: unknown): unknown {
  if (!isPostgrestError(error)) return error
  if (error.code === 'P0001' || error.code === 'P0002') {
    return new UserFacingError(error.message, error)
  }
  if (error.code === '23505') {
    return new UserFacingError('Bu sual artıq bu denemədədir.', error)
  }
  if (error.code === '23503') {
    return new UserFacingError(
      'Bu qeyd başqa yerdə istifadə olunur. Silmək əvəzinə arxivləşdirin.',
      error,
    )
  }
  return error
}

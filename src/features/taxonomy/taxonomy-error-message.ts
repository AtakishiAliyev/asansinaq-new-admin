import { normalizeError } from '@/lib/errors'

// Postgres error codes worth translating for the operator. Everything else
// falls back to the generic normalizer message.
const MESSAGES: Record<string, string> = {
  '23505': 'Bu adda artıq mövcuddur.',
  '23503': 'Bu, istifadədə olduğu üçün silinə bilmir.',
  '23514': 'Bu əməliyyata icazə verilmir.',
}

export function taxonomyErrorMessage(error: unknown): string {
  const normalized = normalizeError(error)
  return MESSAGES[normalized.code] ?? normalized.message
}

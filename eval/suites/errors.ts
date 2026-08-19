import { errorDetail } from '@/lib/errors'
import { eq, ok, suite } from '../harness.ts'

// The failure this guards: a Supabase rejection is a plain object, not an
// Error, so `error instanceof Error ? … : 'naməlum xəta'` recorded five
// identical useless messages against five different questions.
export const errorsSuite = suite('errors', {
  'a Postgrest rejection keeps its code, message and hint'() {
    const detail = errorDetail({
      code: '23514',
      message: 'new row violates check constraint',
      details: 'Failing row contains (…)',
      hint: null,
    })
    ok(detail.includes('23514'))
    ok(detail.includes('check constraint'))
  },

  'a storage rejection keeps its status and message'() {
    const detail = errorDetail({
      statusCode: '413',
      error: 'Payload too large',
      message: 'The object exceeded the maximum allowed size',
    })
    ok(detail.includes('413'))
    ok(detail.includes('maximum allowed size'))
  },

  'a plain Error is passed through'() {
    eq(errorDetail(new Error('şəkil yüklənmədi')), 'şəkil yüklənmədi')
  },

  'an object with nothing recognisable is still readable'() {
    ok(errorDetail({ weird: true }).includes('weird'))
  },

  'nothing at all does not become the string undefined'() {
    eq(errorDetail(undefined), 'naməlum xəta')
  },
})

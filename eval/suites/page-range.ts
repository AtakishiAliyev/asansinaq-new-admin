import {
  formatPages,
  parsePageRange,
  parsePagesLenient,
} from '@/core/segment/page-range'
import { deepEq, eq, suite } from '../harness.ts'

const strict = (input: string, max = 100) => parsePageRange(input, max)

export const pageRangeSuite = suite('page-range', {
  'ranges and single pages combine'() {
    const r = strict('4-8, 11')
    eq(r.ok, true, 'ok')
    if (r.ok) deepEq(r.pages, [4, 5, 6, 7, 8, 11], 'səhifələr')
  },

  'a page past the document is rejected'() {
    eq(strict('4-8', 6).ok, false, 'ok')
  },

  'a reversed range is rejected'() {
    eq(strict('8-4').ok, false, 'ok')
  },

  'the lenient parser keeps what it can while typing'() {
    deepEq([...parsePagesLenient('4-6, x, 9', 100)], [4, 5, 6, 9], 'səhifələr')
  },

  'formatting is the inverse of parsing'() {
    eq(formatPages([4, 5, 6, 7, 8, 11]), '4-8, 11', 'mətn')
    eq(formatPages([]), '', 'boş')
  },
})

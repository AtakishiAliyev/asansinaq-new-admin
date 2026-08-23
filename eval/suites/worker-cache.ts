// What the extract cache key is allowed to ignore.
//
// `ops_cache` is the reason an unchanged re-run is nearly free, and every bug
// this suite pins has the same shape: something that CHANGES the answer was
// left out of the key, so the run served a stale answer and reported a cache
// hit. That reads as a success in every log line and in the cost report, which
// is what makes it expensive to find — twice now it has been found only after
// the wrong answer was already written to a row.
import {
  extractCacheInput,
  type CacheInputRow,
} from '@/core/extract/cache-input'
import { eq, ok, suite } from '../harness.ts'

const CROP = { image: 'aGVsbG8=', mime: 'image/png' }
const CATEGORIES = [1, 2]

const row = (over: Partial<CacheInputRow> = {}): CacheInputRow => ({
  q_no: 3,
  figure_kind: 'none',
  text_layer: null,
  test_no: null,
  repair_round: 0,
  ...over,
})

const key = (over: Partial<CacheInputRow> = {}) =>
  JSON.stringify(extractCacheInput(row(over), CROP, CATEGORIES))

export const workerCacheSuite = suite('worker-cache', {
  'the same question twice is the same key'() {
    eq(key(), key(), 'an unchanged row hits its own entry')
  },

  // The one that cost two live batches. A repair re-reads the same crop with
  // the same prompt, so without the round in the key the "repaired" question
  // comes back byte-identical, the wave reaches the same verdict, and the row
  // burns both repairs having changed nothing.
  'a repair round is not served the answer that failed verification'() {
    ok(key({ repair_round: 1 }) !== key(), 'round 1 does not reuse round 0')
    ok(key({ repair_round: 2 }) !== key({ repair_round: 1 }), 'round 2 does not reuse round 1')
  },

  'the book\u2019s category tree is part of the key'() {
    const other = JSON.stringify(extractCacheInput(row(), CROP, [3, 4]))
    ok(other !== key(), 'a different tree can produce a different category')
  },

  'anything that changes the answer changes the key'() {
    ok(key({ figure_kind: 'rule' }) !== key(), 'having a figure picks a different lane')
    ok(key({ q_no: 4 }) !== key(), 'the expected number is part of the read')
    ok(key({ text_layer: 'x' }) !== key(), 'the text-layer hint is part of the read')
    ok(key({ test_no: 2 }) !== key(), 'the test number is part of the read')
  },

  // The crop is the question. A key that ignored it would serve one question's
  // answer for another's picture.
  'a different crop is a different key'() {
    const other = JSON.stringify(
      extractCacheInput(row(), { image: 'd29ybGQ=', mime: 'image/png' }, CATEGORIES),
    )
    ok(other !== key(), 'the image bytes are in the key')
  },
})

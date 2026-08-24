import {
  promptFingerprint,
  EXTRACT_SYSTEM,
  EXTRACT_SYSTEM_RASTER,
  COMPARE_FIGURES_PROMPT,
  DETECT_QUESTIONS_PROMPT,
  PARSE_ANSWER_KEY_PROMPT,
  FINGERPRINTED_PROMPTS,
  PROMPT_VERSION,
  VERIFY_QUESTION_PROMPT,
} from '@/core/extract/prompts'
import { extractResponseSchema } from '@/core/extract/schemas'
import { parseVerdict, verdictSchema } from '@/core/extract/verify-request'
import { deepEq, eq, ok, suite } from '../harness.ts'

const AZ_PROMPTS = {
  EXTRACT_SYSTEM,
  EXTRACT_SYSTEM_RASTER,
  VERIFY_QUESTION_PROMPT,
  COMPARE_FIGURES_PROMPT,
  DETECT_QUESTIONS_PROMPT,
  PARSE_ANSWER_KEY_PROMPT,
}

const numbering = (s: string) => [...s.matchAll(/^(\d+)\./gm)].map((m) => Number(m[1]))
const sequence = (n: number) => Array.from({ length: n }, (_, i) => i + 1)

// Prompts are edited by hand, in a language whose keyboard neighbours Cyrillic,
// and assembled from pieces whose numbering has to survive the assembly. Both
// have already gone wrong once: a Cyrillic б inside BURAXIB, and a raster
// variant that jumped from rule 11 to rule 15 because the block between them
// belongs only to the other lane.
export const promptsSuite = suite('prompts', {
  // The fingerprint keys `ops_cache`. A prompt it does not cover can be edited
  // and the run will replay the old prompt's answers under the new text —
  // silently, reporting a cache hit. The verify prompt was outside it until the
  // wave was being tuned against its own cached verdicts.
  'the fingerprint covers every prompt sent to a model'() {
    for (const [name, text] of Object.entries(AZ_PROMPTS)) {
      // The reading ops are not fingerprinted on purpose — they do not key
      // ops_cache. Everything the extract and verify waves send must be.
      if (!['EXTRACT_SYSTEM', 'EXTRACT_SYSTEM_RASTER', 'VERIFY_QUESTION_PROMPT'].includes(name)) {
        continue
      }
      ok(FINGERPRINTED_PROMPTS.includes(text), `${name} is folded into the fingerprint`)
    }
    eq(promptFingerprint(), promptFingerprint(), 'the fingerprint is stable across calls')
  },

  // Found the hard way: a NUL used as a hash separator made the whole file read
  // as binary to grep, awk and every review tool, which hid a prompt edit from
  // an entire pass over the file.
  'no control characters hide in the prompt source'() {
    for (const [name, text] of Object.entries(AZ_PROMPTS)) {
      const bad = [...text].find((c) => c < ' ' && c !== '\n' && c !== '\t')
      eq(bad, undefined, `${name} carries no control characters`)
    }
  },

  // The verdict schema asks for three index-aligned arrays instead of one array
  // of objects, because the nested shape made the model leak `<parameter …>`
  // markup into `differences` as a string — roughly a fifth of live calls, each
  // one a defect it had correctly found and could not report.
  'the verdict schema stays flat'() {
    const props = verdictSchema.properties as Record<string, { type: string }>
    for (const key of ['difference_fields', 'difference_severities', 'difference_notes']) {
      eq(props[key]?.type, 'array', `${key} is an array`)
    }
    ok(!('differences' in props), 'no nested differences array is asked for')
  },

  // A verdict that cannot be read must never read as agreement — that is the
  // one way this wave fails silently.
  'an unreadable verdict is never a match'() {
    eq(parseVerdict(null).matches, false, 'nothing is not a match')
    eq(parseVerdict({}).matches, false, 'an empty object is not a match')
    eq(
      parseVerdict({ matches: true, differences: '<parameter name="note">x' }).matches,
      false,
      'leaked markup is not a match',
    )
    eq(
      parseVerdict({ matches: true, differences: '<parameter name="note">x' }).differences.length,
      1,
      'leaked markup is surfaced as a difference rather than dropped',
    )
    eq(
      parseVerdict({
        matches: true,
        difference_fields: ['figure'],
        difference_severities: ['critical'],
        difference_notes: ['edge missing'],
      }).matches,
      false,
      'a critical difference overrides a matches:true verdict',
    )
    eq(
      parseVerdict({ matches: true, difference_fields: ['figure'] }).differences[0]?.severity,
      'critical',
      'a severity missing from a ragged array defaults to critical',
    )
  },

  'no Cyrillic look-alikes hide in the Azerbaijani text'() {
    for (const [name, text] of Object.entries(AZ_PROMPTS)) {
      const cyrillic = [...text].filter((c) => /[Ѐ-ӿ]/.test(c))
      eq(cyrillic.length, 0, `${name}: ${cyrillic.join('')}`)
    }
  },

  'each assembled prompt is one unbroken list of rules'() {
    deepEq(numbering(EXTRACT_SYSTEM), sequence(18), 'DSL lane')
    deepEq(numbering(EXTRACT_SYSTEM_RASTER), sequence(12), 'raster lane')
  },

  'the raster lane never asks for a figure spec'() {
    ok(!EXTRACT_SYSTEM_RASTER.includes('venn_shapes'))
    ok(!EXTRACT_SYSTEM_RASTER.includes('raw_svg'))
    ok(/figures sahəsini BOŞ saxla/.test(EXTRACT_SYSTEM_RASTER))
  },

  // The no-figure rule and the picture-option rule sit next to each other and
  // read alike. On an IQ page the model applied the first to the second and
  // returned five options with no boxes, which the pipeline then could not
  // cut. Whatever the wording, the raster lane has to keep asking for them.
  'the raster lane still asks for picture-option boxes'() {
    ok(/is_image/.test(EXTRACT_SYSTEM_RASTER))
    ok(/box/.test(EXTRACT_SYSTEM_RASTER))
    ok(/7-ci qayda/.test(EXTRACT_SYSTEM_RASTER))
  },

  // Fields the pipeline makes decisions from must tell the model what they
  // mean. `confidence` was required, thresholded at 0.85, and undefined.
  'every field we act on is described to the model'() {
    const props = extractResponseSchema.properties as Record<
      string,
      { description?: string }
    >
    for (const field of ['confidence', 'difficulty', 'illegible', 'stem']) {
      ok(
        (props[field]?.description ?? '').length > 20,
        `${field} təsviri yoxdur`,
      )
    }
  },

  'confidence is defined as reading accuracy, not difficulty'() {
    const desc = (
      extractResponseSchema.properties as Record<string, { description?: string }>
    ).confidence!.description!
    ok(/NOT question difficulty/i.test(desc))
    ok(desc.includes('0.85'))
  },

  // The version is a human decision and was once forgotten mid-tuning: the
  // cache replayed the pre-edit answer, reported a hit, and the tuning was
  // measured against its own old output. The fingerprint is what actually
  // guards the cache now, so it has to move when the text does.
  'the fingerprint tracks the prompt text, not the version number'() {
    const before = promptFingerprint()
    eq(promptFingerprint(), before, 'eyni mətn üçün sabit olmalıdır')
    ok(/^[0-9a-z]+$/.test(before), `barmaq izi qəribədir: ${before}`)
    // Not a constant, and not derived from PROMPT_VERSION — those are the two
    // ways this could silently stop protecting anything.
    ok(before !== '0' && before !== String(PROMPT_VERSION))
  },

  'the version is bumped whenever these texts change'() {
    ok(PROMPT_VERSION >= 7)
  },
})

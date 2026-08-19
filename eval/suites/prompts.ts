import {
  EXTRACT_SYSTEM,
  EXTRACT_SYSTEM_RASTER,
  COMPARE_FIGURES_PROMPT,
  DETECT_QUESTIONS_PROMPT,
  PARSE_ANSWER_KEY_PROMPT,
  SUGGEST_CATEGORY_PROMPT,
  PROMPT_VERSION,
} from '@/core/extract/prompts'
import { extractResponseSchema } from '@/core/extract/schemas'
import { deepEq, eq, ok, suite } from '../harness.ts'

const AZ_PROMPTS = {
  EXTRACT_SYSTEM,
  EXTRACT_SYSTEM_RASTER,
  COMPARE_FIGURES_PROMPT,
  DETECT_QUESTIONS_PROMPT,
  PARSE_ANSWER_KEY_PROMPT,
  SUGGEST_CATEGORY_PROMPT,
}

const numbering = (s: string) => [...s.matchAll(/^(\d+)\./gm)].map((m) => Number(m[1]))
const sequence = (n: number) => Array.from({ length: n }, (_, i) => i + 1)

// Prompts are edited by hand, in a language whose keyboard neighbours Cyrillic,
// and assembled from pieces whose numbering has to survive the assembly. Both
// have already gone wrong once: a Cyrillic б inside BURAXIB, and a raster
// variant that jumped from rule 11 to rule 15 because the block between them
// belongs only to the other lane.
export const promptsSuite = suite('prompts', {
  'no Cyrillic look-alikes hide in the Azerbaijani text'() {
    for (const [name, text] of Object.entries(AZ_PROMPTS)) {
      const cyrillic = [...text].filter((c) => /[Ѐ-ӿ]/.test(c))
      eq(cyrillic.length, 0, `${name}: ${cyrillic.join('')}`)
    }
  },

  'each assembled prompt is one unbroken list of rules'() {
    deepEq(numbering(EXTRACT_SYSTEM), sequence(15), 'DSL lane')
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

  'the version is bumped whenever these texts change'() {
    ok(PROMPT_VERSION >= 3)
  },
})

import { canonMath, compareQuestions } from '@/core/questions/compare'
import type {
  ExtractedOption,
  ExtractedQuestion,
} from '@/core/questions/extraction'
import { eq, ok, suite } from '../harness.ts'

const same = (a: string, b: string) => canonMath(a) === canonMath(b)

function q(over: Partial<ExtractedQuestion> = {}): ExtractedQuestion {
  return {
    numberSeen: 1,
    stem: 'Sual',
    options: [],
    figures: null,
    illegible: false,
    clipped: false,
    foreign: false,
    confidence: 1,
    ...over,
  } as ExtractedQuestion
}

const opt = (label: ExtractedOption['label'], tex: string): ExtractedOption => ({
  label,
  tex,
})

export const compareSuite = suite('compare', {
  'cosmetic LaTeX differences are not disagreements'() {
    ok(same('x^{2}', 'x^2'), 'eksponent mötərizəsi')
    ok(same('\\sqrt{5}', '\\sqrt5'), 'kök mötərizəsi')
    ok(same('a \\leq b', 'a\\le b'), '\\leq = \\le')
    ok(same('1{,}62', '1,62'), 'onluq vergül işarəsi')
    ok(same('a\\quad b', 'ab'), 'boşluq makrosu')
    ok(same('\\dfrac{1}{2}', '\\frac12'), 'dfrac + mötərizə')
  },

  'real LaTeX differences stay differences'() {
    ok(!same('x^{12}', 'x^12'), 'iki rəqəmli eksponent')
    ok(!same('-5', '5'), 'işarə dönməsi')
    ok(!same('1,62', '1,63'), 'rəqəm dəyişməsi')
    ok(!same('\\{a\\}', '\\{b\\}'), 'qaçırılmış çoxluq mötərizəsi')
  },

  'a digit swapped in prose is caught'() {
    // The gap this suite exists for: 0.99 similar, so the fuzzy prose gate
    // reads it as agreement and the question would be verified with a
    // hallucinated number.
    const r = compareQuestions(
      q({ stem: 'Bir kitabın 75 səhifəsi oxundu, neçə səhifə qalır?' }),
      q({ stem: 'Bir kitabın 76 səhifəsi oxundu, neçə səhifə qalır?' }),
    )
    eq(r.equal, false, 'razılaşma')
  },

  'a decimal comma written as a point is the same number'() {
    const r = compareQuestions(
      q({ stem: 'Kəmər 1,5 metrdir' }),
      q({ stem: 'Kəmər 1.5 metrdir' }),
    )
    eq(r.equal, true, 'razılaşma')
  },

  'a spelling difference is still tolerated'() {
    const r = compareQuestions(
      q({ stem: 'Əli 3 kq alma aldı' }),
      q({ stem: 'Əli 3 kq alma aldi' }),
    )
    eq(r.equal, true, 'razılaşma')
  },

  'a sign flip inside an option is caught'() {
    const r = compareQuestions(
      q({ options: [opt('A', '-5'), opt('B', '7')] }),
      q({ options: [opt('A', '5'), opt('B', '7')] }),
    )
    eq(r.equal, false, 'razılaşma')
    eq(r.diffs[0]?.field, 'option A', 'fərqin sahəsi')
  },

  'a vanished figure is caught'() {
    const r = compareQuestions(
      q({ figures: { v: 1, items: [{ kind: 'venn', shapes: [], shaded: [] }] } as never }),
      q({ figures: null }),
    )
    eq(r.equal, false, 'razılaşma')
    eq(r.diffs[0]?.field, 'figure', 'fərqin sahəsi')
  },

  'a picture option never equals a text option'() {
    const r = compareQuestions(
      q({ options: [{ label: 'A', isImage: true }] as never }),
      q({ options: [opt('A', '5')] }),
    )
    eq(r.equal, false, 'razılaşma')
  },
})

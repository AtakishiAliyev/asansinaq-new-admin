import { lintQuestion, worstLevel } from '@/core/questions/lint'
import type { ExtractedQuestion } from '@/core/questions/extraction'
import { eq, notOk, ok, suite } from '../harness.ts'

function q(over: Partial<ExtractedQuestion> = {}): ExtractedQuestion {
  return {
    numberSeen: 1,
    stem: 'Aşağıdakılardan hansı doğrudur?',
    options: (['A', 'B', 'C', 'D', 'E'] as const).map((label, i) => ({
      label,
      tex: String(i + 1),
    })),
    figures: null,
    illegible: false,
    clipped: false,
    foreign: false,
    confidence: 1,
    warnings: [],
    ...over,
  } as ExtractedQuestion
}

const codes = (question: ExtractedQuestion, expected?: number) =>
  lintQuestion(question, expected).map((f) => f.code)

export const lintSuite = suite('lint', {
  'a clean question raises nothing'() {
    eq(lintQuestion(q()).length, 0, 'bayraq sayı')
    eq(worstLevel([]), 'clean', 'səviyyə')
  },

  'a missing option is an error'() {
    const flags = codes(q({ options: q().options.slice(0, 4) }))
    ok(flags.includes('option_count'), `option_count: ${flags.join(', ')}`)
  },

  'two identical options mean one was misread'() {
    const options = q().options
    options[1] = { label: 'B', tex: '1' }
    ok(codes(q({ options })).includes('option_duplicate'), 'option_duplicate')
  },

  'an empty stem is an error'() {
    ok(codes(q({ stem: '   ' })).includes('empty_stem'), 'empty_stem')
  },

  'broken LaTeX in the stem is an error'() {
    ok(codes(q({ stem: 'Hesabla: $\\frac{1$' })).includes('stem_latex'), 'stem_latex')
  },

  'the model saying it could not read the crop is an error'() {
    ok(codes(q({ illegible: true })).includes('illegible'), 'illegible')
    eq(worstLevel(lintQuestion(q({ illegible: true }))), 'error', 'səviyyə')
  },

  'a number that disagrees with the crop is a warning, not a failure'() {
    const flags = lintQuestion(q({ numberSeen: 5 }), 4)
    ok(
      flags.some((f) => f.code === 'number_mismatch' && f.level === 'warning'),
      'number_mismatch xəbərdarlıqdır',
    )
    notOk(worstLevel(flags) === 'error', 'xəta deyil')
  },

  'low model confidence is a warning'() {
    ok(codes(q({ confidence: 0.4 })).includes('low_confidence'), 'low_confidence')
  },

  'a stem that names a drawing with no figure is an error'() {
    for (const stem of [
      'Yukarıdaki şekilde verilenlere göre x kaçtır?',
      'Yuxarıdakı qrafikə görə f(2) neçədir?',
      'ABC üçbucağında |AB| = 5 sm-dir. |BC| neçədir?',
      'Cədvəldəki məlumatlara görə orta qiymət neçədir?',
      'Şəkildəki paralelkenarın sahəsi neçədir?',
    ]) {
      ok(codes(q({ stem })).includes('missing_figure'), `fiqur tələb olunur: ${stem}`)
    }
  },

  'arithmetic words are not drawings'() {
    // These fire an error and cost a reviewer every time, so the vocabulary
    // deliberately leaves out the words that are also arithmetic.
    for (const stem of [
      'x ədədinin kvadratı 49-dursa, x neçədir?',
      'Cavabınızı açıqlayın: 2 + 2 neçədir?',
      '8 ədədinin kubu neçədir?',
      'Dairənin uzunluğu düsturu ilə hesablayın',
    ]) {
      notOk(codes(q({ stem })).includes('missing_figure'), `fiqur tələb olunmur: ${stem}`)
    }
  },

  // These books print one instruction above a group and then number bare
  // diagrams under it. The crop holds the item, never the heading — failing
  // those threw away a figure that had already been generated and paid for.
  'a diagram question with no printed stem is a warning, not a failure'() {
    const flags = lintQuestion(
      q({ stem: '', figures: { v: 1, items: [{ kind: 'image', src: 'x.png' }] } }),
      1,
    )
    const stem = flags.find((f) => f.code === 'stem_from_figure')
    ok(stem !== undefined)
    eq(stem!.level, 'warning')
    eq(flags.some((f) => f.code === 'empty_stem'), false)
  },

  'a stem-less question with no figure is still a failed read'() {
    const flags = lintQuestion(q({ stem: '', figures: null }), 1)
    eq(flags.some((f) => f.code === 'empty_stem'), true)
  },

  // A whole page of picture-option questions reached review with four blank
  // options and no error at all: the model declared them images, no image was
  // ever generated, and `isImage` alone satisfied the emptiness check.
  'an option declared a picture but never given one is empty'() {
    const flags = lintQuestion(
      q({
        options: [
          { label: 'A', tex: '36' },
          { label: 'B', isImage: true },
          { label: 'C', isImage: true },
          { label: 'D', isImage: true },
          { label: 'E', isImage: true },
        ],
      }),
      1,
    )
    eq(flags.filter((f) => f.code === 'option_empty').length, 4)
    eq(worstLevel(flags), 'error')
  },

  'an option that actually has its picture is complete'() {
    const flags = lintQuestion(
      q({
        options: (['A', 'B', 'C', 'D', 'E'] as const).map((label) => ({
          label,
          isImage: true,
          image: `${label}.png`,
        })),
      }),
      1,
    )
    eq(flags.some((f) => f.code === 'option_empty'), false)
  },

  // The model wrote its deliberation into the field — quoting our own rule
  // back — and it compiled as LaTeX, so every other check waved it through.
  'an option holding prose instead of a value is an error'() {
    const flags = lintQuestion(
      q({
        options: [
          {
            label: 'A',
            tex: '36 12 64 (image option placeholder, do not use this tex field if is_image is true, but schema requires no tex, I will omit tex)',
          },
          { label: 'B', tex: '2' },
          { label: 'C', tex: '3' },
          { label: 'D', tex: '4' },
          { label: 'E', tex: '5' },
        ],
      }),
      1,
    )
    ok(flags.some((f) => f.code === 'option_prose'))
  },

  'a long but legitimate option is not prose'() {
    const flags = lintQuestion(
      q({ options: q().options.map((o) => ({ ...o, tex: '\\{a, b, c, d, e, f\\}' })) }),
      1,
    )
    eq(flags.some((f) => f.code === 'option_prose'), false)
  },
})

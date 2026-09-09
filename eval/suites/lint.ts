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

  // Three reviewed rows widened the stem beyond what is printed; one pulled
  // option A's content into the question itself, which leaves the option
  // looking like the obvious answer and the stem asserting what it should ask.
  'an option pulled into the stem is flagged'() {
    const flags = lintQuestion({
      stem: 'A və B çoxluqları verilir\n\\{1,2,3\\}',
      options: [
        { label: 'A', tex: '\\{1,2,3\\}' },
        { label: 'B', tex: '\\{2,3\\}' },
        { label: 'C', tex: '\\{1,2\\}' },
        { label: 'D', tex: '\\{3\\}' },
        { label: 'E', tex: '\\{1\\}' },
      ],
    } as never)
    ok(
      flags.some((f) => f.code === 'stem_echoes_option'),
      `expected stem_echoes_option, got ${flags.map((f) => f.code).join(',')}`,
    )
  },

  // A stem legitimately shares a short token with an option — "f(2)" asked
  // about, "2" offered — and flagging that would fire on most of the bank.
  'a stem that merely mentions a short option value is not flagged'() {
    const flags = lintQuestion({
      stem: '$f(2)=?$',
      options: [
        { label: 'A', tex: '2' },
        { label: 'B', tex: '3' },
        { label: 'C', tex: '4' },
        { label: 'D', tex: '5' },
        { label: 'E', tex: '6' },
      ],
    } as never)
    ok(
      !flags.some((f) => f.code === 'stem_echoes_option'),
      'a short shared token is not an echo',
    )
  },

  // Three live rows came back with the column sum typed into the stem — `3a5`,
  // `+638`, `10b3` as three lines and no figure — and were auto-approved,
  // because a warning does not block auto-approval and nothing else objected.
  // The question is about lining the columns up; text does not line up.
  'a column sum typed into the stem is an error'() {
    const flags = lintQuestion(q({ stem: '3a5 üç basamaklı doğal sayıdır.\n3a5\n+ 638\n10b3\nToplam 3 ile bölünüyorsa a + b kaçtır?' }))
    const flag = flags.find((f) => f.code === 'column_sum_as_text')
    ok(flag, `column_sum_as_text: ${flags.map((f) => f.code).join(', ')}`)
    eq(flag!.level, 'error', 'xəbərdarlıq avto-təsdiqi dayandırmır')
  },

  'four stacked addends are caught too'() {
    const stem = 'Verilen işlemde iki basamaklı dört doğal sayı toplanıyor.\naa\nab\nbb\n+ ba\n198\nBuna göre kaç farklı ba sayısı yazılabilir?'
    ok(codes(q({ stem })).includes('column_sum_as_text'), 'dörd toplanan tutulmur')
  },

  // The figure IS there — the model may quote a line of it in prose, and
  // flagging that would fire on every column question that got it right.
  'a stem beside a real vertical_arithmetic figure is left alone'() {
    const flags = codes(
      q({
        stem: '3a5\n+ 638\n10b3',
        figures: {
          v: 1,
          items: [
            {
              kind: 'vertical_arithmetic',
              rows: [{ tex: '3a5' }, { tex: '638', op: '+' }],
              hlineAfter: [1],
              resultTex: '10b3',
            },
          ],
        },
      } as never),
    )
    notOk(flags.includes('column_sum_as_text'), 'fiqur varkən bayraq qalxır')
  },

  // Ordinary multi-line stems must survive: premise lines carry `=`, words and
  // punctuation, and none of them is a stacked operation.
  'a premise stated on its own lines is not a column sum'() {
    const stem = 'a ve b tam sayılardır.\n$a = 3$\n$b = 5$\nBuna göre a + b kaçtır?'
    notOk(codes(q({ stem })).includes('column_sum_as_text'), 'adi şərt sətirləri bayraq qaldırır')
  },

  // Two lines are not enough: a stacked operation the books print has at least
  // two operands and a result, and a two-line run is too easy to hit by
  // accident — a short label above a short value, say.
  'two short lines alone are not a column sum'() {
    notOk(codes(q({ stem: 'K\n+ 12' })).includes('column_sum_as_text'), 'iki sətir bayraq qaldırır')
  },

  // Three live rows from one page: the one whose shape matched the prompt's own
  // example came back right, and the two that did not both put the second rule
  // under the FIRST partial product and gave the second no indent. All three
  // were auto-approved — the numbers were read correctly and nothing looked at
  // the layout, which in a masked-digit puzzle is the entire question.
  'a result with no rule above it is an error'() {
    const flags = codes(
      q({
        figures: {
          v: 1,
          items: [
            {
              kind: 'vertical_arithmetic',
              rows: [{ tex: '5•' }, { tex: '•6', op: '×' }, { tex: '32•' }, { tex: '•••', op: '+', indent: 1 }],
              hlineAfter: [1, 2],
              resultTex: '4•04',
            },
          ],
        },
      } as never),
    )
    ok(flags.includes('stack_result_unruled'), `stack_result_unruled: ${flags.join(', ')}`)
  },

  'two partial products at the same indent are an error'() {
    const flags = codes(
      q({
        figures: {
          v: 1,
          items: [
            {
              kind: 'vertical_arithmetic',
              rows: [{ tex: '•12' }, { tex: '7•', op: '×' }, { tex: '•••2' }, { tex: '•8•4', op: '+' }],
              hlineAfter: [1, 3],
              resultTex: 'a13b2',
            },
          ],
        },
      } as never),
    )
    ok(flags.includes('stack_indent_flat'), `stack_indent_flat: ${flags.join(', ')}`)
  },

  // The shape the prompt shows, and the one row of the three that came back
  // right. Nothing here may fire, or every correct multiplication is blocked.
  'a well-formed multiplication stack raises nothing'() {
    const flags = codes(
      q({
        figures: {
          v: 1,
          items: [
            {
              kind: 'vertical_arithmetic',
              rows: [{ tex: '••••' }, { tex: '36', op: '×' }, { tex: '•••••' }, { tex: '9762', op: '+', indent: 1 }],
              hlineAfter: [1, 3],
              resultTex: '••••••',
            },
          ],
        },
      } as never),
    )
    notOk(flags.includes('stack_result_unruled'), `xətt bayrağı yanlış qalxır: ${flags.join(', ')}`)
    notOk(flags.includes('stack_indent_flat'), `indent bayrağı yanlış qalxır: ${flags.join(', ')}`)
  },

  // A two-row addition has one rule and no partial products at all; neither
  // check may reach for it.
  'a two-row addition raises nothing'() {
    const flags = codes(
      q({
        figures: {
          v: 1,
          items: [
            {
              kind: 'vertical_arithmetic',
              rows: [{ tex: '3a5' }, { tex: '638', op: '+' }],
              hlineAfter: [1],
              resultTex: '10b3',
            },
          ],
        },
      } as never),
    )
    notOk(flags.includes('stack_result_unruled'), `xətt bayrağı: ${flags.join(', ')}`)
    notOk(flags.includes('stack_indent_flat'), `indent bayrağı: ${flags.join(', ')}`)
  },

  // A multiplier with a zero digit lets the book skip a partial product, so the
  // step is two places rather than one. Strictly increasing, not exactly +1.
  'a skipped partial product steps two places and is allowed'() {
    const flags = codes(
      q({
        figures: {
          v: 1,
          items: [
            {
              kind: 'vertical_arithmetic',
              rows: [{ tex: '123' }, { tex: '306', op: '×' }, { tex: '738' }, { tex: '369', op: '+', indent: 2 }],
              hlineAfter: [1, 3],
              resultTex: '37638',
            },
          ],
        },
      } as never),
    )
    notOk(flags.includes('stack_indent_flat'), `iki mövqelik addım bayraq qaldırır: ${flags.join(', ')}`)
  },
})

import { figureRefs } from '@/core/questions/figure-refs'
import { wireToQuestion } from '@/core/questions/extraction'
import { lintQuestion } from '@/core/questions/lint'
import { deepEq, eq, notOk, ok, suite } from '../harness.ts'

// Does the figure contain what the question asks about?
//
// From a real row: a question asking for m(CDE) whose figure declared five
// angles, none of them at D. It passed every other check — geometry kind,
// correct topology, marks present, no errors — and was missing the only thing
// the reader needs. That row is kept unfixed in the bank as the first thing
// M6's compare wave has to catch; this suite is the free half of the same job.

/** The FEM figure shape: two parallel rays cut by a path through C. */
const figure = (over: Record<string, unknown> = {}) => ({
  kind: 'geometry',
  width: 320,
  height: 240,
  points: [
    { id: 'B', x: 90, y: 60, label: 'B' },
    { id: 'A', x: 300, y: 60, label: 'A' },
    { id: 'D', x: 220, y: 130, label: 'D' },
    { id: 'E', x: 280, y: 130, label: 'E' },
    { id: 'F', x: 150, y: 140, label: 'F' },
    { id: 'C', x: 175, y: 220, label: 'C' },
  ],
  lines: [
    { from: 'B', to: 'A', kind: 'ray' },
    { from: 'D', to: 'E', kind: 'ray' },
    { from: 'B', to: 'C' },
    { from: 'B', to: 'F' },
    { from: 'F', to: 'C' },
    { from: 'D', to: 'C' },
  ],
  angles: [{ at: ['B', 'F', 'C'], label: '110°' }],
  ...over,
})

const question = (stem: string, over?: Record<string, unknown>) =>
  wireToQuestion({ stem, figures: [figure(over)] })

const codes = (stem: string, over?: Record<string, unknown>) =>
  lintQuestion(question(stem, over)).map((f) => f.code)

export const figureRefsSuite = suite('figure-refs', {
  'the notation these books actually use is parsed'() {
    const refs = figureRefs(
      '[BA // [DE\n[BF] ve [CF] açıortay\n$m(\\widehat{BFC}) = 110°$\n' +
        'Yukarıdaki verilere göre, $m(\\widehat{CDE}) = \\alpha$ kaç derecedir?',
    )
    deepEq(
      refs.angles.map((a) => a.text).sort(),
      ['BFC', 'CDE'],
      'bucaq istinadları',
    )
    // The middle letter is the vertex; getting that wrong would check the
    // wrong point and pass everything.
    eq(refs.angles.find((a) => a.text === 'CDE')?.vertex, 'D')
    deepEq(
      refs.edges.map((e) => e.text).sort(),
      ['BA', 'BF', 'CF', 'DE'],
      'parça/şüa istinadları',
    )
  },

  'other angle spellings are read too'() {
    eq(figureRefs('$m(ABC)$').angles[0]?.vertex, 'B')
    eq(figureRefs('$\\angle ABC$').angles[0]?.vertex, 'B')
    eq(figureRefs('∠ABC').angles[0]?.vertex, 'B')
    eq(figureRefs('$m(\\hat{ABC})$').angles[0]?.vertex, 'B')
  },

  // A lint that cries wolf gets ignored, so the parser has to stay quiet on
  // prose. Every one of these is ordinary question text.
  'ordinary prose is not read as geometry'() {
    for (const text of [
      'Bir sayının 3 katı 12 ise, m(x) kaçtır?',
      '$f(x) = 2x + 1$ olduğuna göre $f(3)$ kaçtır?',
      'A) 12 B) 14 C) 16',
      '$[0, 1]$ aralığında',
      'x + y = 10 ve xy = 21',
    ]) {
      const refs = figureRefs(text)
      eq(refs.angles.length, 0, `bucaq uyduruldu: ${text}`)
    }
  },

  // The row this exists for. Everything about it is healthy except the one
  // thing the question needs.
  'an asked angle the figure never marks is caught'() {
    const found = codes(
      '$[BA // [DE$\n$m(\\widehat{BFC}) = 110°$\n' +
        'Yukarıdaki verilere göre, $m(\\widehat{CDE}) = \\alpha$ kaç derecedir?',
    )
    ok(found.includes('figure_angle_not_marked'), found.join(','))
    // A warning, not an error: the geometry is right and a reviewer can add
    // the mark. Errors are for figures that cannot show it at all.
    notOk(found.includes('figure_missing_referenced_angle'), found.join(','))
  },

  'the same question passes once the angle is marked'() {
    const found = codes(
      '$m(\\widehat{CDE}) = \\alpha$ kaç derecedir?',
      { angles: [{ at: ['C', 'D', 'E'], label: '\\alpha' }] },
    )
    notOk(found.includes('figure_angle_not_marked'), found.join(','))
  },

  // Marked at the wrong vertex is the same failure wearing a disguise: the
  // arc is drawn, it just annotates a different angle.
  'an angle marked at the wrong vertex does not count as marked'() {
    const found = codes(
      '$m(\\widehat{DEF}) = \\alpha$ kaç derecedir?',
      {
        points: [
          { id: 'D', x: 20, y: 20, label: 'D' },
          { id: 'E', x: 120, y: 20, label: 'E' },
          { id: 'F', x: 120, y: 120, label: 'F' },
        ],
        lines: [
          { from: 'D', to: 'E' },
          { from: 'E', to: 'F' },
        ],
        // Vertex F, not E.
        angles: [{ at: ['E', 'F', 'D'], label: '\\alpha' }],
      },
    )
    ok(found.includes('figure_angle_not_marked'), found.join(','))
  },

  // Structurally impossible is a different, worse thing: no mark would help.
  'an angle whose arm is not joined to its vertex is an error'() {
    const found = codes('$m(\\widehat{AFE})$ kaç derecedir?')
    ok(found.includes('figure_missing_referenced_angle'), found.join(','))
  },

  'an angle naming a point the figure does not have is an error'() {
    const found = codes('$m(\\widehat{XYZ})$ kaç derecedir?')
    ok(found.includes('figure_missing_referenced_angle'), found.join(','))
  },

  'a referenced segment with no edge behind it is an error'() {
    const found = codes('$[AE]$ uzunluğu kaçtır?')
    ok(found.includes('figure_missing_referenced_segment'), found.join(','))
  },

  'segments the figure does contain are not flagged'() {
    const found = codes('$[BF]$ ve $[CF]$ açıortay')
    notOk(found.some((c) => c.startsWith('figure_missing')), found.join(','))
  },

  // Only the structured kind can be asked. A raw_svg figure has no topology to
  // check, and flagging every one of them would make the rule useless.
  'a raw_svg figure is not checked, because it cannot be'() {
    const q = wireToQuestion({
      stem: '$m(\\widehat{CDE}) = \\alpha$ kaç derecedir?',
      figures: [
        {
          kind: 'raw_svg',
          raw_svg: '<svg viewBox="0 0 10 10"><line x1="0" y1="0" x2="9" y2="9"/></svg>',
        },
      ],
    })
    const found = lintQuestion(q).map((f) => f.code)
    notOk(found.some((c) => c.startsWith('figure_missing') || c === 'figure_angle_not_marked'))
  },

  'a question with no figure at all is left to the missing-figure rule'() {
    const q = wireToQuestion({ stem: '$m(\\widehat{CDE})$ kaç derecedir?' })
    const found = lintQuestion(q).map((f) => f.code)
    notOk(found.includes('figure_angle_not_marked'), found.join(','))
  },
})

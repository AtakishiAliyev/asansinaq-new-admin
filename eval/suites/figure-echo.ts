import type { FigItem } from '@/core/figures/figspec'
import { stripFigureEcho } from '@/core/questions/figure-echo'
import { eq, ok, suite } from '../harness.ts'

const stack: FigItem = {
  kind: 'vertical_arithmetic',
  rows: [{ tex: '4\\ 5\\ B' }, { tex: 'C\\ A\\ 9', op: '+' }],
  hlineAfter: [1],
  resultTex: 'A\\ 2\\ A',
}

const division: FigItem = {
  kind: 'division_scheme',
  style: 'arithmetic',
  dividendTex: 'A',
  divisorTex: 'B',
  quotientTex: '4',
  remainderTex: '5',
}

export const figureEchoSuite = suite('figure-echo', {
  // Rule 14 was tightened to say an alt-alta operation is a figure and must not
  // be written into the stem. The model now does BOTH, so the reader sees the
  // operation twice — once set as the book sets it, once as a column of stray
  // fragments above the question.
  'a stack repeated in the stem is dropped'() {
    const stem =
      'A, B, C birer rakam olmak üzere,\n$4\\ 5\\ B$\n$+\\ C\\ A\\ 9$\n$A\\ 2\\ A$\nYukarıda verilen toplama işlemine göre,\n$A + B + C$ toplamı kaçtır?'
    const out = stripFigureEcho(stem, [stack])
    eq(
      out,
      'A, B, C birer rakam olmak üzere,\nYukarıda verilen toplama işlemine göre,\n$A + B + C$ toplamı kaçtır?',
      'təkrar silinmir',
    )
  },

  // The stem writes `$4\ 5\ B$` where the figure holds `4\ 5\ B`, and the
  // operator row is `$+\ ba$` against a bare `ba`. Delimiters, spacing
  // commands and a leading operator all have to come off before the two can be
  // recognised as one thing.
  'the maths delimiters and the operator do not hide the repeat'() {
    const out = stripFigureEcho('Şərt.\n$4\\ 5\\ B$\n$+\\ C\\ A\\ 9$\nSual?', [stack])
    ok(!out.includes('C\\ A\\ 9'), `operator sətri qalıb: ${out}`)
  },

  'a division scheme is recognised the same way'() {
    const out = stripFigureEcho('A ve B pozitif.\n$A$\n$B$\nSual?', [division])
    eq(out, 'A ve B pozitif.\nSual?', 'bölmə sxeminin təkrarı qalır')
  },

  // The floor of two is the whole safety margin. A stem legitimately names one
  // of the figure's values on a line of its own — the premise of the sentence
  // under it — and gutting that would lose wording the book prints.
  'a single echoed line is left alone'() {
    const stem = 'Şərt.\n$A\\ 2\\ A$\nSual?'
    eq(stripFigureEcho(stem, [stack]), stem, 'tək sətir silinib — kitabın sözü itir')
  },

  // Inline mentions are prose, not the stack: the whole line has to BE the
  // cell, or every question that names its own unknown loses its sentence.
  'a value mentioned inside a sentence is not an echo'() {
    const stem = '$4\\ 5\\ B$ üç basamaklıdır və $A\\ 2\\ A$ da elədir.\nSual?'
    eq(stripFigureEcho(stem, [stack]), stem, 'cümlə içindəki istinad silinib')
  },

  'a stem with no figure is returned unchanged'() {
    const stem = 'Şərt.\n$725$\n$c57$\nSual?'
    eq(stripFigureEcho(stem, []), stem, 'fiqursuz sətir dəyişib')
  },

  // A drawn figure holds no typeset cells, so nothing of the stem can match it
  // and nothing may be removed on its account.
  'a figure of another kind removes nothing'() {
    const stem = 'Şərt.\n$A$\n$B$\nSual?'
    const image: FigItem = { kind: 'image', src: 'x.png' }
    eq(stripFigureEcho(stem, [image]), stem, 'çəkilmiş fiqur mətni yeyir')
  },
})

// Two checks that read a figure against what the question actually asks.
//
// Both exist because a figure can be internally flawless and still answer a
// different question, which is invisible to every check that looks at the
// figure alone. Every fixture is a live spec.
import { divisionRoleProblems } from '@/core/questions/division-roles'
import { setRefProblems, stemSetNames } from '@/core/questions/set-refs'
import type { DivisionScheme, FigureDoc } from '@/core/figures/figspec'
import { eq, ok, suite } from '../harness.ts'

const scheme = (over: Partial<DivisionScheme> = {}): DivisionScheme => ({
  kind: 'division_scheme',
  style: 'arithmetic',
  dividendTex: '17',
  divisorTex: '5',
  quotientTex: '3',
  remainderTex: '2',
  ...over,
})

const venn = (ids: string[]): FigureDoc => ({
  v: 1,
  items: [
    {
      kind: 'venn',
      width: 300,
      height: 230,
      shapes: ids.map((id, i) => ({
        id,
        label: id,
        geom: { type: 'circle' as const, cx: 100 + i * 70, cy: 115, r: 70 },
      })),
      shaded: [],
    },
  ],
})

export const divisionRolesSuite = suite('division-roles', {
  'a correct numeric scheme is clean'() {
    eq(divisionRoleProblems(scheme()).length, 0, '17 = 5x3 + 2')
  },

  // p28q6: dividend "A", divisor "n^2/n", quotient EMPTY. Two roles crammed
  // into one cell and a third left blank, rendering as a tidy scheme.
  'a divisor holding a division is caught'() {
    const problems = divisionRoleProblems(
      scheme({ dividendTex: 'A', divisorTex: 'n^2/n', quotientTex: '', remainderTex: '64' }),
    )
    ok(
      problems.some((p) => p.code === 'division_role_crammed'),
      'the crammed cell is named',
    )
    ok(
      problems.some((p) => p.code === 'division_role_empty'),
      'and so is the empty one',
    )
  },

  'a \\frac in a cell counts as crammed too'() {
    const problems = divisionRoleProblems(scheme({ divisorTex: '\\frac{n^2}{n}' }))
    ok(problems.some((p) => p.code === 'division_role_crammed'), 'caught')
  },

  // The strongest check available, and only for numeric schemes: a scheme that
  // fails its own arithmetic is not a reading of the page.
  'a numeric scheme that does not add up is caught'() {
    const problems = divisionRoleProblems(
      scheme({ dividendTex: '17', divisorTex: '3', quotientTex: '5', remainderTex: '4' }),
    )
    ok(problems.some((p) => p.code === 'division_arithmetic'), 'caught')
  },

  'a remainder as large as the divisor is caught'() {
    const problems = divisionRoleProblems(
      scheme({ dividendTex: '17', divisorTex: '5', quotientTex: '2', remainderTex: '7' }),
    )
    ok(problems.some((p) => p.code === 'division_arithmetic'), 'caught')
  },

  // Symbolic cells cannot be checked arithmetically, and pretending otherwise
  // would flag every algebraic scheme in the book.
  'a symbolic scheme is not judged on arithmetic'() {
    const problems = divisionRoleProblems(
      scheme({ dividendTex: 'a^2+2b', divisorTex: 'a+1', quotientTex: '2b', remainderTex: '0' }),
    )
    eq(problems.length, 0, 'nothing to check, nothing reported')
  },

  'a missing remainder means zero, not missing'() {
    const problems = divisionRoleProblems(
      scheme({ dividendTex: '15', divisorTex: '5', quotientTex: '3', remainderTex: undefined }),
    )
    eq(problems.length, 0, '15 = 5x3 + 0')
  },
})

export const setRefsSuite = suite('set-refs', {
  'set names are read out of the stem'() {
    const found = stemSetNames('$A\\backslash(B\\cup C)=?$')
    ok(found.has('A') && found.has('B') && found.has('C'), 'all three')
  },

  // The bug this parser was rewritten for: matching PAIRS consumed B as the
  // second half of the A-B pair, so it could never start the B-C pair and C —
  // the very set that was missing from the live row — was never seen.
  'a third set in a chain is not swallowed by the second'() {
    for (const stem of ['$A\\backslash(B\\cup C)=?$', 'A\\(B∪C)', '$A \\cap B \\cap C$']) {
      const found = stemSetNames(stem)
      eq(found.size, 3, `three sets in ${stem}`)
    }
  },

  'a capital that is not a set is not counted'() {
    // "L kaçtır?" — L is the unknown being asked for, not a set.
    const found = stemSetNames('Yukarıdaki bölme işlemlerine göre, L kaçtır?')
    eq(found.size, 0, 'no sets claimed')
  },

  'cardinality and set-builder forms are read'() {
    ok(stemSetNames('$s(A) = 12$').has('A'), 's(A)')
    ok(stemSetNames('$B = \\{1,2\\}$').has('B'), 'B = {…}')
    ok(stemSetNames("$C'$ nedir?").has('C'), "C'")
  },

  // p307/7: the venn drew B and C while the stem asked about A as well, so the
  // diagram could not answer its own question.
  'a set the stem needs and the diagram lacks is an error'() {
    const problems = setRefProblems(venn(['B', 'C']), '$A\\backslash(B\\cup C)=?$')
    ok(
      problems.some((p) => p.code === 'venn_missing_set'),
      'the hole is named',
    )
    ok(problems[0]!.message.includes('A'), 'and it says which set')
  },

  'a diagram holding every set the stem uses is clean'() {
    eq(setRefProblems(venn(['A', 'B', 'C']), '$A\\backslash(B\\cup C)=?$').length, 0, 'clean')
  },

  // Plenty of these questions carry their sets only in the picture, so silence
  // in the stem has to mean silence here.
  'a stem naming no sets is not evidence of anything'() {
    eq(setRefProblems(venn(['A', 'B']), 'Taralı alan = ?').length, 0, 'nothing claimed')
  },

  'a question with no venn is left alone'() {
    eq(setRefProblems({ v: 1, items: [] }, '$A\\cap B$').length, 0, 'nothing to check')
  },
})

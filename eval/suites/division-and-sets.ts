// Two checks that read a figure against what the question actually asks.
//
// Both exist because a figure can be internally flawless and still answer a
// different question, which is invisible to every check that looks at the
// figure alone. Every fixture is a live spec.
import { divisionRoleProblems, polyDegree } from '@/core/questions/division-roles'
import { setRefProblems, stemSetNames } from '@/core/questions/set-refs'
import type { DivisionScheme, FigureDoc } from '@/core/figures/figspec'
import { eq, notOk, ok, suite } from '../harness.ts'

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
  // into one cell, rendering as a tidy scheme. The slash is the defect; the
  // blank quotient on its own is a form the book prints (see below).
  'a divisor holding a division is caught'() {
    const problems = divisionRoleProblems(
      scheme({ dividendTex: 'A', divisorTex: 'n^2/n', quotientTex: '', remainderTex: '64' }),
    )
    ok(
      problems.some((p) => p.code === 'division_role_crammed'),
      'the crammed cell is named',
    )
    notOk(
      problems.some((p) => p.code === 'division_role_empty'),
      'a blank quotient beside a remainder is not itself a defect',
    )
  },

  // The polynomial-remainder form: `P(x) │ x²+1`, a minus, the rule, `7x+7`
  // beneath — and NO quotient, because the question is about the remainder.
  // Fifty-six live schemes of this shape were flagged for an empty quotient
  // and not one was a misread; the flag kept every one of them out of the
  // verified lane and bought two paid repairs each for nothing.
  'a remainder-only scheme is the book\'s own form, not a defect'() {
    const problems = divisionRoleProblems(
      scheme({ dividendTex: 'P(x)', divisorTex: 'x^2+1', quotientTex: '', remainderTex: '7x+7' }),
    )
    eq(problems.length, 0, `bölümsüz sxem bayraq qaldırır: ${problems.map((p) => p.code).join(',')}`)
  },

  // Two numbers and a bar say nothing: one of the lower cells has to exist.
  'a scheme with neither quotient nor remainder is caught'() {
    const problems = divisionRoleProblems(
      scheme({ dividendTex: 'A', divisorTex: 'B', quotientTex: '', remainderTex: undefined }),
    )
    ok(problems.some((p) => p.code === 'division_role_empty'), 'nə bölüm, nə qalıq')
  },

  // The remainder-only form read with the remainder in the wrong cell: the
  // book prints `P(x) │ x−4`, a minus, the rule, `7` under the DIVIDEND; the
  // model wrote the 7 under the divisor as the quotient. Nine live schemes,
  // three approved, and the verifier passed every one.
  'a remainder written into the quotient cell is caught by its degree'() {
    for (const [divisor, quotient] of [['x-4', '7'], ['x^3-27', 'x^2+3x-5'], ['x^2-5x+6', '(3x-5)'], ['x^2-1', '3x']]) {
      const problems = divisionRoleProblems(
        scheme({ dividendTex: 'P(x)', divisorTex: divisor, quotientTex: quotient, remainderTex: undefined }),
      )
      ok(problems.some((p) => p.code === 'division_role_misplaced'), `${quotient} / ${divisor} tutulmur`)
    }
  },

  // `B(x)` under `x²+1` IS a quotient named as a function; the `x` inside the
  // brackets is not a degree. A bare symbol is unknowable and left alone too.
  'a quotient named as a function or a symbol is not judged by degree'() {
    for (const quotient of ['B(x)', 'K(x)', 'P(x+1)', 'K', 'a']) {
      const problems = divisionRoleProblems(
        scheme({ dividendTex: 'x^4+3x^3', divisorTex: 'x^2+1', quotientTex: quotient, remainderTex: undefined }),
      )
      notOk(problems.some((p) => p.code === 'division_role_misplaced'), `${quotient} yanlış tutulub`)
    }
    eq(polyDegree('B(x)'), null, 'funksiya yazılışı dərəcəsizdir')
    eq(polyDegree('x^2+3x-5'), 2, 'kvadrat')
    eq(polyDegree('7'), 0, 'sabit')
    eq(polyDegree('(3x-5)'), 1, 'mötərizəli xətti')
  },

  // The subtraction sign read as a cell. Three live rows put "-" in the
  // remainder cell and the remainder under the divisor; the wave passed all
  // three.
  'a lone minus in the remainder cell marks the quotient as the remainder'() {
    for (const [divisor, quotient] of [['x^3-3', 'K'], ['x^2-1', '2x+5'], ['x^2-5x-14', '2x+3']]) {
      const problems = divisionRoleProblems(
        scheme({ dividendTex: 'P(x)', divisorTex: divisor, quotientTex: quotient, remainderTex: '-' }),
      )
      eq(problems.filter((p) => p.code === 'division_role_misplaced').length, 1, `${quotient} / ${divisor}`)
      ok(problems[0]!.message.includes('çıxma işarəsidir'), 'səbəb minusu adlandırmır')
    }
  },

  // `K(x)` under `x³+1` with the question asking `K = ?` and five answers of
  // degree at most two: the answers carry the unknown's degree, and it is
  // below the divisor's, so K(x) is the remainder. Two live rows, one of
  // them approved — and the same reading leaves the book's one quotient-only
  // scheme alone, because its answers reach the divisor's degree.
  'a named unknown the options put below the divisor\u2019s degree is the remainder'() {
    const cases: [string, string, string, string[]][] = [
      ['K(x)', 'x^3+1', '\\Rightarrow K = ?', ['-2x', '-x', 'x^2', '2x^2', '-x^2-x']],
      ['K(x)', 'x-2', 'K(x) = ?', ['10', '14', '18', '22', '26']],
      ['K', 'x^2+x-12', 'K(x) = ?', ['x-4', '4x-1', 'x+4', '4-x', '4x+1']],
      ['K', 'x-1', 'K = ?', ['3', '5', '7', '9', '11']],
      ['K', 'x^2+2x+4', 'K=?', ['-4x', '-4x+5', '-4x-9', '4x-2', '4x+10']],
      ['K', 'x^2-3x+2', 'K(x) = ?', ['2x+1', 'x-2', '-3x+6', '2x-1', 'x-1']],
    ]
    for (const [quotient, divisor, stem, optionTexs] of cases) {
      const problems = divisionRoleProblems(
        scheme({ dividendTex: 'P(x)', divisorTex: divisor, quotientTex: quotient, remainderTex: '' }),
        { stem, optionTexs },
      )
      ok(problems.some((p) => p.code === 'division_role_misplaced'), `${quotient} / ${divisor} tutulmur`)
    }
  },

  'a named quotient whose options reach the divisor\u2019s degree is left alone'() {
    const problems = divisionRoleProblems(
      scheme({ dividendTex: 'x^4+2x^3-x^2+1', divisorTex: 'x^2+x-1', quotientTex: 'B(x)', remainderTex: '' }),
      { stem: 'B(x) = ?', optionTexs: ['x^2+x-1', '-2x^2+x', '-x^2+4x', '-x^2-x', '-x^2-x-1'] },
    )
    notOk(problems.some((p) => p.code === 'division_role_misplaced'), 'B(x) bölümü yanlış tutulub')
  },

  // The options only speak for the name the question asks about. Numeric
  // answers to `a+b = ?` say nothing about a `B(x)` in the quotient cell.
  'options for a different unknown do not judge the quotient'() {
    const problems = divisionRoleProblems(
      scheme({ dividendTex: 'x^3+ax^2+b', divisorTex: 'x^2+1', quotientTex: 'B(x)', remainderTex: '' }),
      { stem: 'a+b = ?', optionTexs: ['-2', '0', '2', '4', '6'] },
    )
    notOk(problems.some((p) => p.code === 'division_role_misplaced'), 'a+b variantları B(x)-i mühakimə edib')
  },

  // What the lint cannot see: a quotient the model invented beside a remainder
  // it read correctly. `x` under `x²−x−1` is of the degree a real quotient
  // would have, so nothing here can call it wrong; the verifier's claims block
  // is what carries that case.
  'an invented quotient beside a correct remainder is left to the verifier'() {
    const problems = divisionRoleProblems(
      scheme({ dividendTex: 'x^3+x^2+ax-b', divisorTex: 'x^2-x-1', quotientTex: 'x', remainderTex: '3x' }),
      { stem: 'a+b = ?', optionTexs: ['-2', '0', '2', '4', '6'] },
    )
    eq(problems.length, 0, 'determinist yoxlama bunu tuta bilməz — tutursa, səbəbi yaz')
  },

  'a quotient of full degree beside an empty remainder is fine'() {
    const problems = divisionRoleProblems(
      scheme({ dividendTex: 'x^4+3x^3+2x^2-x-6', divisorTex: 'x^2+1', quotientTex: 'x^2+3x+1', remainderTex: undefined }),
    )
    notOk(problems.some((p) => p.code === 'division_role_misplaced'), 'tam dərəcəli bölüm yanlış tutulub')
  },

  'a missing dividend or divisor is still caught'() {
    ok(
      divisionRoleProblems(scheme({ divisorTex: '' })).some((p) => p.code === 'division_role_empty'),
      'boş bölən',
    )
    ok(
      divisionRoleProblems(scheme({ dividendTex: '' })).some((p) => p.code === 'division_role_empty'),
      'boş bölünən',
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

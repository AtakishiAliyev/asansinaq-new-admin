import { sampleCurve } from '@/core/figures/curve'
import { parseSetExpr, setIdsUsed } from '@/core/figures/set-expr'
import { deepEq, eq, ok, suite } from '../harness.ts'

const idsOf = (expr: string) => [...setIdsUsed(parseSetExpr(expr))].sort()

export const figuresSuite = suite('figures', {
  'an expression curve samples across its domain'() {
    const c = sampleCurve({ type: 'expr', expr: 'x^2', domain: [-2, 2] })
    eq(c.ok, true, 'ok')
    ok(c.points.length > 10, `nöqtə sayı ${c.points.length}`)
  },

  'an unparseable expression fails instead of drawing nothing'() {
    eq(sampleCurve({ type: 'expr', expr: 'x +* ', domain: [0, 1] }).ok, false, 'ok')
  },

  'a spline through declared points keeps them'() {
    const c = sampleCurve({
      type: 'spline',
      points: [
        [0, 0],
        [1, 2],
        [2, 1],
      ],
    })
    eq(c.ok, true, 'ok')
    ok(c.points.length >= 3, 'nöqtələr saxlanılır')
  },

  'set algebra parses the notations a model actually emits'() {
    deepEq(idsOf('A \\cap B'), ['A', 'B'], 'LaTeX kəsişmə')
    deepEq(idsOf('A ∩ B'), ['A', 'B'], 'unicode kəsişmə')
    deepEq(idsOf("A' \\cup B"), ['A', 'B'], 'tamamlayıcı')
    deepEq(idsOf('(A \\cap B) \\setminus C'), ['A', 'B', 'C'], 'fərq')
    deepEq(idsOf('I \\cup II'), ['I', 'II'], 'Roma rəqəmləri ayrı çoxluqdur')
  },

  'a malformed set expression throws rather than rendering a wrong region'() {
    let threw = false
    try {
      parseSetExpr('A \\cap')
    } catch {
      threw = true
    }
    eq(threw, true, 'xəta atılır')
  },
})

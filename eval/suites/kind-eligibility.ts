// Which figures a structured kind may claim.
//
// Every fixture here is a real spec from one live page. The failure they share
// is the dangerous one: each rendered without throwing, so the row looked
// extracted, and only a comparison against the original showed the figure was
// not the figure. Two of them even passed the verification wave.
import { documentIneligible, figureIneligible } from '@/core/figures/kind-eligibility'
import type { FigItem } from '@/core/figures/figspec'
import { eq, ok, suite } from '../harness.ts'

const circle = (id: string, cx: number): FigItem =>
  ({
    kind: 'venn',
    width: 300,
    height: 230,
    shapes: [{ id, label: id, geom: { type: 'circle', cx, cy: 115, r: 70 } }],
    shaded: [],
  }) as FigItem

/** p307/8 — one circle and two rectangles. */
const RECT_VENN: FigItem = {
  kind: 'venn',
  width: 300,
  height: 230,
  shapes: [
    { id: 'B', label: 'B', geom: { type: 'circle', cx: 115, cy: 115, r: 70 } },
    { id: 'A', label: 'A', geom: { type: 'rect', x: 80, y: 95, w: 150, h: 45 } },
    { id: 'C', label: 'C', geom: { type: 'rect', x: 90, y: 140, w: 150, h: 45 } },
  ],
  shaded: ['A-C', 'C-A'],
} as FigItem

/** p307/11 — a triangle standing in for a set. */
const TRIANGLE_VENN: FigItem = {
  kind: 'venn',
  width: 300,
  height: 230,
  shapes: [
    {
      id: 'A',
      label: 'A',
      geom: { type: 'triangle', points: [[10, 10], [200, 10], [100, 200]] },
    },
    { id: 'B', label: 'B', geom: { type: 'circle', cx: 115, cy: 115, r: 70 } },
    { id: 'C', label: 'C', geom: { type: 'circle', cx: 185, cy: 115, r: 70 } },
  ],
  shaded: ['(A∩C)\\B'],
} as FigItem

/** p307/7 — the set ids were OPERATIONS: "A\B" and "A\C". */
const OPERATOR_VENN: FigItem = {
  kind: 'venn',
  width: 300,
  height: 230,
  shapes: [
    { id: 'A\\B', label: 'A\\B', geom: { type: 'circle', cx: 115, cy: 115, r: 70 } },
    { id: 'A\\C', label: 'A\\C', geom: { type: 'circle', cx: 185, cy: 115, r: 70 } },
  ],
  shaded: [],
} as FigItem

/** p365/12 — two splines through eyeballed points, for a function never given. */
const SPLINE_GRAPH: FigItem = {
  kind: 'function_graph',
  panels: [
    {
      x: { min: -4, max: 2, ticks: [] },
      y: { min: -1, max: 2, ticks: [] },
      curves: [
        {
          id: 'f',
          color: 'primary',
          def: { type: 'spline', points: [[-4, 1], [-2, 0], [0, 1], [1, 2], [2, -1]] },
        },
      ],
    },
  ],
} as FigItem

/** p371/8 — f(x) = ax^3 with `a` unknown, rendered as x*x*x*0.335. */
const FABRICATED_CONSTANT: FigItem = {
  kind: 'function_graph',
  panels: [
    {
      x: { min: -3, max: 3, ticks: [] },
      y: { min: -5, max: 5, ticks: [] },
      curves: [
        { id: 'f', color: 'primary', def: { type: 'expr', expr: 'x*x*x*0.335', domain: [-3, 3] } },
        { id: 'g', color: 'secondary', def: { type: 'spline', points: [[-2, 1], [0, 0], [1, 2], [2, 3]] } },
      ],
    },
  ],
} as FigItem

/** What the kind is actually for: circles, plain names, computable curve. */
const GOOD_VENN: FigItem = {
  kind: 'venn',
  width: 300,
  height: 230,
  shapes: [
    { id: 'A', label: 'A', geom: { type: 'circle', cx: 115, cy: 115, r: 70 } },
    { id: 'B', label: 'B', geom: { type: 'circle', cx: 185, cy: 115, r: 70 } },
  ],
  shaded: ['A∩B'],
} as FigItem

const GOOD_GRAPH: FigItem = {
  kind: 'function_graph',
  panels: [
    {
      x: { min: -3, max: 3, ticks: [] },
      y: { min: -1, max: 5, ticks: [] },
      curves: [{ id: 'p', color: 'primary', def: { type: 'expr', expr: 'x^2', domain: [-2, 2] } }],
    },
  ],
} as FigItem

export const kindEligibilitySuite = suite('kind-eligibility', {
  // A venn's whole meaning is which regions overlap, and that is a property of
  // circles. A rectangle "set" overlaps differently from the circle the page
  // drew, so the diagram answers a different question.
  'a venn made of rectangles is refused'() {
    const bad = figureIneligible(RECT_VENN)
    ok(bad !== null, 'refused')
    ok(bad!.reason.includes('rect'), 'and names the shape')
  },

  'a venn with a triangle is refused'() {
    ok(figureIneligible(TRIANGLE_VENN) !== null, 'refused')
  },

  // The one that produced eight venn_unknown_set errors from a single bad shape
  // list: every region expression referred to a set the renderer never had.
  'a set named after an operation is refused'() {
    const bad = figureIneligible(OPERATOR_VENN)
    ok(bad !== null, 'refused')
    ok(bad!.reason.includes('A\\B'), 'and quotes the name')
  },

  'a plain two-circle venn is allowed'() {
    eq(figureIneligible(GOOD_VENN), null, 'this is what the kind is for')
    eq(figureIneligible(circle('A', 115)), null, 'one circle is fine too')
  },

  // A spline is a smooth line through points somebody chose by eye. For a
  // function the question never states, that is a drawing of a guess.
  'a spline curve is refused'() {
    const bad = figureIneligible(SPLINE_GRAPH)
    ok(bad !== null, 'refused')
    ok(bad!.reason.includes('spline'), 'and says why')
  },

  'a graph mixing a fabricated constant with a spline is refused'() {
    ok(figureIneligible(FABRICATED_CONSTANT) !== null, 'refused')
  },

  'a concrete computable curve is allowed'() {
    eq(figureIneligible(GOOD_GRAPH), null, 'x^2 is a real expression')
  },

  'kinds outside the two gated ones are untouched'() {
    eq(figureIneligible({ kind: 'image', src: 'a.png' } as FigItem), null, 'image always allowed')
    eq(
      figureIneligible({ kind: 'cubes', cubes: [{ front: {} }] } as FigItem),
      null,
      'cubes unaffected',
    )
  },

  'a document reports every ineligible item, not just the first'() {
    const found = documentIneligible([RECT_VENN, GOOD_VENN, SPLINE_GRAPH])
    eq(found.length, 2, 'both over-reaches are named')
    eq(found[0]?.kind, 'venn', 'in order')
    eq(found[1]?.kind, 'function_graph', 'in order')
  },
})

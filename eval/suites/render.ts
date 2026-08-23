import type { GeometryFig } from '@/core/figures/figspec'
import { renderFigItem, renderFigureDoc } from '@/core/figures/render'
import { wireToQuestion } from '@/core/questions/extraction'
import { lintQuestion } from '@/core/questions/lint'
import { eq, notOk, ok, suite } from '../harness.ts'

// The first coverage rendering has ever had.
//
// It was DOM code, so the only way to see a figure was to mount it, and
// eval/README said so out loud. Everything below runs offline against an SVG
// string, which is what moving the renderer into core bought.

const TRIANGLE: GeometryFig = {
  kind: 'geometry',
  width: 320,
  height: 240,
  points: [
    { id: 'A', x: 40, y: 200, label: 'A', dot: true },
    { id: 'B', x: 280, y: 200, label: 'B', dot: true },
    { id: 'C', x: 160, y: 40, label: 'C', dot: true },
  ],
  lines: [
    { from: 'A', to: 'B' },
    { from: 'A', to: 'C', ticks: 2 },
    { from: 'B', to: 'C', ticks: 2 },
  ],
  angles: [{ at: ['A', 'C', 'B'], label: '40°', arcs: 1 }],
}

const count = (svg: string, pattern: RegExp): number => (svg.match(pattern) ?? []).length

export const renderSuite = suite('render', {
  'a figure renders to a self-contained svg with no browser'() {
    const svg = renderFigItem(TRIANGLE)
    ok(svg.startsWith('<svg '), `svg ilə başlamır: ${svg.slice(0, 40)}`)
    ok(svg.includes('xmlns="http://www.w3.org/2000/svg"'), 'xmlns yoxdur')
    ok(svg.includes('viewBox="0 0 320 240"'), 'viewBox yoxdur')
  },

  // foreignObject is why the old renderer could not be rasterised: resvg and
  // sharp do not implement it at all, so a figure whose labels lived inside one
  // came out blank. Nothing may put it back.
  'nothing depends on foreignObject, which no rasteriser implements'() {
    const svg = renderFigItem(TRIANGLE)
    notOk(/foreignObject/i.test(svg), 'foreignObject qayıdıb — rasterizasiya sınacaq')
    notOk(/<div|<span/i.test(svg), 'SVG içində HTML var')
  },

  // The same spec has to produce the same bytes in the worker and in the
  // browser, or every figure differs and a render-and-compare wave learns
  // nothing from any of them. The old venn renderer used a module-level
  // counter that never reset.
  'the same figure renders byte-identically every time'() {
    eq(renderFigItem(TRIANGLE), renderFigItem(TRIANGLE))
    // And is not disturbed by what was rendered before it.
    renderFigItem({ ...TRIANGLE, width: 999 })
    eq(renderFigItem(TRIANGLE), renderFigItem(TRIANGLE))
  },

  // The marks ARE the question. A bisector figure with the arcs missing is a
  // different problem, usually an unsolvable one, and this is the whole reason
  // the kind exists.
  'equal-length ticks are drawn, one stroke per tick'() {
    const one = renderFigItem({
      ...TRIANGLE,
      lines: [{ from: 'A', to: 'B', ticks: 1 }],
      angles: [],
    })
    const three = renderFigItem({
      ...TRIANGLE,
      lines: [{ from: 'A', to: 'B', ticks: 3 }],
      angles: [],
    })
    // One <line> for the segment itself, plus one per tick.
    eq(count(one, /<line /g), 2, 'bir tik')
    eq(count(three, /<line /g), 4, 'üç tik')
  },

  'parallel chevrons are drawn, one per declared mark'() {
    const svg = renderFigItem({
      ...TRIANGLE,
      lines: [
        { from: 'A', to: 'B', parallel: 2 },
        { from: 'A', to: 'C', parallel: 2 },
      ],
      angles: [],
    })
    eq(count(svg, /<polyline /g), 4, 'iki xəttdə ikiqat ox')
  },

  // A right angle is a square, never an arc labelled 90°. A reader looking for
  // the square does not accept the arc — they are not interchangeable.
  'a right angle is a square, not an arc'() {
    const svg = renderFigItem({
      ...TRIANGLE,
      angles: [{ at: ['A', 'C', 'B'], right: true }],
    })
    eq(count(svg, /<polyline /g), 1, 'kvadrat işarəsi')
    eq(count(svg, /<path /g), 0, 'qövs olmamalıdır')
  },

  'congruent-angle arcs are drawn, one path per arc'() {
    const svg = renderFigItem({
      ...TRIANGLE,
      angles: [{ at: ['A', 'C', 'B'], arcs: 2 }],
    })
    eq(count(svg, /<path /g), 2)
  },

  // A ray runs off the canvas; a segment stops. Drawing a ray as a segment is
  // a different figure, so the extent has to be visible in the output.
  'a ray leaves the canvas and a segment does not'() {
    const seg = renderFigItem({
      ...TRIANGLE,
      lines: [{ from: 'A', to: 'B', kind: 'segment' }],
      angles: [],
    })
    const ray = renderFigItem({
      ...TRIANGLE,
      lines: [{ from: 'A', to: 'B', kind: 'ray' }],
      angles: [],
    })
    ok(seg.includes('x2="280"'), 'parça B-də bitməlidir')
    notOk(ray.includes('x2="280"'), 'şüa B-də bitməməlidir')
  },

  'labels are real svg text, and their content is escaped'() {
    const svg = renderFigItem({
      ...TRIANGLE,
      points: [{ id: 'A', x: 10, y: 10, label: '<b>&</b>', dot: true }],
      lines: [],
      angles: [],
    })
    ok(svg.includes('<text'), 'mətn düyünü yoxdur')
    notOk(svg.includes('<b>'), 'etiket markup kimi keçib')
    ok(svg.includes('&lt;b&gt;&amp;'), 'etiket escape olunmayıb')
  },

  'a document renders one svg per item, in order'() {
    const svgs = renderFigureDoc({ v: 1, items: [TRIANGLE, TRIANGLE] })
    eq(svgs.length, 2)
    eq(svgs[0], svgs[1])
  },

  // Silence is the failure mode this whole lane exists to catch: a figure that
  // renders to nothing looks exactly like a question with no figure.
  'a kind that cannot be rendered yet says so instead of vanishing'() {
    const svg = renderFigItem({
      kind: 'table',
      cells: [['1', '2']],
    })
    ok(svg.length > 0, 'boş qayıtdı')
    ok(/not renderable/.test(svg), 'səbəb yazılmayıb')
  },

  // ---- the wire → figure → lint path for the new kind ----

  'the model can express a bisector, and it survives the wire'() {
    const q = wireToQuestion({
      stem: 'S',
      figures: [
        {
          kind: 'geometry',
          width: 300,
          height: 200,
          points: [
            { id: 'O', x: 20, y: 180, label: 'O', dot: true },
            { id: 'A', x: 280, y: 180, label: 'A' },
            { id: 'B', x: 200, y: 40, label: 'B' },
            { id: 'C', x: 120, y: 20, label: 'C' },
          ],
          lines: [
            { from: 'O', to: 'A', kind: 'ray' },
            { from: 'O', to: 'B', kind: 'ray' },
            { from: 'O', to: 'C', kind: 'ray' },
          ],
          angles: [
            { at: ['A', 'O', 'B'], arcs: 1 },
            { at: ['B', 'O', 'C'], arcs: 1 },
          ],
        },
      ],
    })
    const fig = q.figures?.items[0]
    eq(fig?.kind, 'geometry')
    const geo = fig as GeometryFig
    eq(geo.angles?.length, 2, 'iki bucaq')
    // The equal arc counts ARE the statement that OB bisects. Losing them is
    // losing the given.
    eq(geo.angles?.[0]?.arcs, 1)
    eq(geo.angles?.[1]?.arcs, 1)
    eq(count(renderFigItem(geo), /<path /g), 2, 'hər bucaq üçün bir qövs')
  },

  'a line to a point that was never declared is dropped, not drawn from nowhere'() {
    const q = wireToQuestion({
      stem: 'S',
      figures: [
        {
          kind: 'geometry',
          width: 100,
          height: 100,
          points: [{ id: 'A', x: 10, y: 10 }],
          lines: [
            { from: 'A', to: 'GHOST' },
            { from: 'A', to: 'A' },
          ],
          angles: [{ at: ['A', 'GHOST', 'A'] }],
        },
      ],
    })
    // Nothing left to draw once the phantom references go, so the figure is
    // dropped entirely rather than kept as a single stray point.
    eq(q.figures, null)
  },

  'a degenerate angle is an error a reviewer sees'() {
    const q = wireToQuestion({
      stem: 'S',
      options: [
        { label: 'A', tex: '1' },
        { label: 'B', tex: '2' },
        { label: 'C', tex: '3' },
        { label: 'D', tex: '4' },
        { label: 'E', tex: '5' },
      ],
      figures: [
        {
          kind: 'geometry',
          width: 100,
          height: 100,
          points: [
            { id: 'A', x: 10, y: 10 },
            { id: 'B', x: 90, y: 90 },
          ],
          lines: [{ from: 'A', to: 'B' }],
          angles: [{ at: ['A', 'A', 'B'] }],
        },
      ],
    })
    const codes = lintQuestion(q).map((f) => f.code)
    ok(codes.includes('geo_degenerate_angle'), codes.join(','))
  },

  'two points printed at the same spot are flagged as a misread'() {
    const q = wireToQuestion({
      stem: 'S',
      figures: [
        {
          kind: 'geometry',
          width: 100,
          height: 100,
          points: [
            { id: 'A', x: 10, y: 10 },
            { id: 'B', x: 10, y: 10 },
            { id: 'C', x: 90, y: 90 },
          ],
          lines: [{ from: 'A', to: 'C' }],
        },
      ],
    })
    const codes = lintQuestion(q).map((f) => f.code)
    ok(codes.includes('geo_coincident_points'), codes.join(','))
  },

  // The kind exists to take work AWAY from raw_svg, so the prompt has to
  // prefer it. If this drifts, geometry silently stops being used and the
  // marks start disappearing again.
  'geometry is offered before the raw_svg escape hatch'() {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return import('@/core/extract/prompts').then(({ EXTRACT_SYSTEM }) => {
      const geo = EXTRACT_SYSTEM.indexOf('kind="geometry"')
      const raw = EXTRACT_SYSTEM.indexOf('kind="raw_svg"')
      ok(geo !== -1, 'geometry qaydası yoxdur')
      ok(raw !== -1, 'raw_svg qaydası yoxdur')
      ok(geo < raw, 'geometry raw_svg-dən sonra gəlir')
    })
  },
})

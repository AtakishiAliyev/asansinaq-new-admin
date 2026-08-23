import type { GeometryFig } from '@/core/figures/figspec'
import {
  CLEARANCE,
  layoutGeometry,
  renderFigItem,
  renderFigureDoc,
  texToUnicode,
} from '@/core/figures/render'
import { boxDistance, boxSegDistance, type Vec } from '@/core/figures/layout'
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

// Two rays from one vertex with equal arcs: the bisector figure, and the
// shape that put a 30° label on top of a ray.
const BISECTOR: GeometryFig = {
  kind: 'geometry',
  width: 300,
  height: 200,
  points: [
    { id: 'O', x: 20, y: 180, label: 'O', dot: true },
    { id: 'A', x: 280, y: 180, label: 'A' },
    { id: 'B', x: 220, y: 60, label: 'B' },
    { id: 'C', x: 120, y: 20, label: 'C' },
  ],
  lines: [
    { from: 'O', to: 'A', kind: 'ray' },
    { from: 'O', to: 'B', kind: 'ray' },
    { from: 'O', to: 'C', kind: 'ray' },
  ],
  angles: [
    { at: ['A', 'O', 'B'], label: '30°', arcs: 1 },
    { at: ['B', 'O', 'C'], label: '30°', arcs: 1 },
  ],
}

// Deliberately cramped: six labelled points close together, which is where
// naive fixed-offset placement piles labels on top of each other.
const CROWDED: GeometryFig = {
  kind: 'geometry',
  width: 260,
  height: 200,
  points: [
    { id: 'A', x: 30, y: 20, label: 'A', dot: true },
    { id: 'B', x: 250, y: 20, label: 'B', dot: true },
    { id: 'C', x: 140, y: 90, label: 'C', dot: true },
    { id: 'E', x: 140, y: 150, label: 'E', dot: true },
    { id: 'F', x: 220, y: 150, label: 'F', dot: true },
    { id: 'D', x: 60, y: 190, label: 'D', dot: true },
  ],
  lines: [
    { from: 'B', to: 'A', kind: 'ray', parallel: 1 },
    { from: 'B', to: 'C' },
    { from: 'C', to: 'D' },
    { from: 'D', to: 'E' },
    { from: 'E', to: 'F', kind: 'ray', parallel: 1 },
    { from: 'C', to: 'E' },
  ],
  angles: [
    { at: ['A', 'B', 'C'], label: '20°' },
    { at: ['B', 'C', 'D'], label: '120°' },
    { at: ['C', 'D', 'E'], label: '10°' },
  ],
}

const count = (svg: string, pattern: RegExp): number => (svg.match(pattern) ?? []).length

export const renderSuite = suite('render', {
  'a figure renders to a self-contained svg with no browser'() {
    const svg = renderFigItem(TRIANGLE)
    ok(svg.startsWith('<svg '), `svg ilə başlamır: ${svg.slice(0, 40)}`)
    ok(svg.includes('xmlns="http://www.w3.org/2000/svg"'), 'xmlns yoxdur')
    ok(svg.includes('viewBox="0 0 320 240"'), 'viewBox yoxdur')
  },

  // Shipped broken once: the closing tag repeated the opening tag's attributes
  // (`</text x="0" …>`), which browsers forgive and XML parsers do not. The
  // figures looked correct on screen and would have failed the instant M6 tried
  // to rasterise one.
  'the output is well-formed: every element closes with its own name'() {
    const svg = renderFigItem(CROWDED)
    notOk(/<\/[a-zA-Z]+[ \t][^>]*>/.test(svg), 'bağlayan teqdə atribut var')
    const opens = [...svg.matchAll(/<([a-zA-Z]+)(?=[ />])/g)].map((m) => m[1]!)
    const selfClosing = (svg.match(/\/>/g) ?? []).length
    const closes = [...svg.matchAll(/<\/([a-zA-Z]+)>/g)].map((m) => m[1]!)
    eq(opens.length - selfClosing, closes.length, 'açılan/bağlanan teq sayı')
    // And the names pair up, innermost first.
    const stack: string[] = []
    for (const m of svg.matchAll(/<(\/?)([a-zA-Z]+)(?:[^>]*?)(\/?)>/g)) {
      if (m[1]) eq(stack.pop(), m[2], 'bağlanma sırası')
      else if (!m[3]) stack.push(m[2]!)
    }
    eq(stack.length, 0, 'bağlanmamış teq qaldı')
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

  // A ray runs off the canvas; a segment stops. Drawing a ray as a segment is a
  // different figure. Asserted against the LAYOUT rather than against a literal
  // coordinate: points are now fitted to the canvas, so raw numbers from the
  // spec no longer appear in the output at all.
  'a ray leaves the canvas and a segment does not'() {
    const seg = layoutGeometry({
      ...TRIANGLE,
      lines: [{ from: 'A', to: 'B', kind: 'segment' }],
      angles: [],
    })
    const ray = layoutGeometry({
      ...TRIANGLE,
      lines: [{ from: 'A', to: 'B', kind: 'ray' }],
      angles: [],
    })
    const touchesEdge = (l: { strokes: { a: Vec; b: Vec }[]; width: number }) => {
      const s0 = l.strokes[0]!
      return Math.max(s0.a.x, s0.b.x) > l.width - 1
    }
    notOk(touchesEdge(seg), 'parça kətanın kənarına çatmamalıdır')
    ok(touchesEdge(ray), 'şüa kətanın kənarına çatmalıdır')
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

  // ---- the polish pass: text, clearance, proportion ----

  // A backslash on a diagram is not a degraded label, it is a wrong one: the
  // reader sees a word where the question put a variable, and nothing about
  // the picture says the renderer failed rather than the extraction.
  'no backslash survives into rendered text'() {
    const svg = renderFigItem({
      ...TRIANGLE,
      points: [
        { id: 'A', x: 40, y: 200, label: '\\alpha', dot: true },
        { id: 'B', x: 280, y: 200, label: '30^\\circ', dot: true },
        { id: 'C', x: 160, y: 40, label: '\\widehat{ABC}', dot: true },
      ],
      angles: [{ at: ['A', 'C', 'B'], label: '2\\beta' }],
    })
    const texts = [...svg.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((m) => m[1]!)
    ok(texts.length >= 4, `gözlənilən 4 etiket, tapılan ${texts.length}`)
    for (const t of texts) notOk(t.includes('\\'), `etiketdə backslash qaldı: ${t}`)
    ok(svg.includes('α'), 'alpha unicode-a çevrilməyib')
    ok(svg.includes('β'), 'beta unicode-a çevrilməyib')
    ok(svg.includes('30°'), 'dərəcə işarəsi yaranmayıb')
  },

  'the tex mapper covers the vocabulary figures actually use'() {
    eq(texToUnicode('\\alpha'), 'α')
    eq(texToUnicode('30^\\circ'), '30°')
    eq(texToUnicode('30^{\\circ}'), '30°')
    eq(texToUnicode('\\angle ABC'), '∠ ABC')
    eq(texToUnicode('$x_1$'), 'x₁')
    eq(texToUnicode('\\frac{a}{2}'), 'a/2')
    // Unknown commands lose the backslash rather than keeping it: wrong but
    // legible beats a rendering-failure glyph on the page.
    eq(texToUnicode('\\wibble'), 'wibble')
    notOk(texToUnicode('\\a\\b\\c{}').includes('\\'))
  },

  // The failure this pass exists for: q10's 30° sat directly on the ray it
  // described, and q9's labels sat on each other.
  'every label keeps its clearance from every stroke and every other label'() {
    for (const fig of [TRIANGLE, BISECTOR, CROWDED]) {
      const layout = layoutGeometry(fig)
      for (const box of layout.labels) {
        for (const stroke of layout.strokes) {
          const d = boxSegDistance(box, stroke)
          ok(
            d >= CLEARANCE - 0.01,
            `etiket ${JSON.stringify(box)} xəttə ${d.toFixed(1)}px yaxındır`,
          )
        }
      }
      for (let i = 0; i < layout.labels.length; i++) {
        for (let j = i + 1; j < layout.labels.length; j++) {
          const d = boxDistance(layout.labels[i]!, layout.labels[j]!)
          ok(d >= CLEARANCE - 0.01, `iki etiket ${d.toFixed(1)}px aralıdır`)
        }
      }
    }
  },

  'labels stay inside the canvas'() {
    const layout = layoutGeometry(CROWDED)
    for (const b of layout.labels) {
      ok(b.x >= 0 && b.y >= 0, `etiket kətandan kənarda: ${JSON.stringify(b)}`)
      ok(
        b.x + b.w <= layout.width && b.y + b.h <= layout.height,
        `etiket kətandan daşır: ${JSON.stringify(b)}`,
      )
    }
  },

  // The model draws on whatever scale it likes. A figure specified in a 40px
  // corner has no room for its own labels, and one specified across 4000 units
  // must not overflow.
  'the point cloud is fitted to the canvas whatever scale it arrives on'() {
    const tiny = layoutGeometry({
      ...TRIANGLE,
      points: [
        { id: 'A', x: 0, y: 0, label: 'A', dot: true },
        { id: 'B', x: 6, y: 0, label: 'B', dot: true },
        { id: 'C', x: 3, y: 5, label: 'C', dot: true },
      ],
    })
    const huge = layoutGeometry({
      ...TRIANGLE,
      points: [
        { id: 'A', x: 0, y: 0, label: 'A', dot: true },
        { id: 'B', x: 4000, y: 0, label: 'B', dot: true },
        { id: 'C', x: 2000, y: 3000, label: 'C', dot: true },
      ],
    })
    for (const layout of [tiny, huge]) {
      const xs = layout.strokes.flatMap((s) => [s.a.x, s.b.x])
      const ys = layout.strokes.flatMap((s) => [s.a.y, s.b.y])
      const spanX = Math.max(...xs) - Math.min(...xs)
      const spanY = Math.max(...ys) - Math.min(...ys)
      ok(spanX > layout.width * 0.4, `en çox dar: ${spanX} / ${layout.width}`)
      ok(spanY > layout.height * 0.3, `hündürlük çox dar: ${spanY} / ${layout.height}`)
      ok(Math.max(...xs) <= layout.width + 0.5, 'kətandan daşır')
    }
  },

  // q9's α arc came out larger than the angle it annotated, because the radius
  // was a constant. It has to be a fraction of the shorter arm.
  'arc radius scales with the figure rather than being a fixed pixel size'() {
    const radiusOf = (svg: string) => {
      const m = /A ([0-9.]+) [0-9.]+ 0 0 [01]/.exec(svg)
      return m ? Number(m[1]) : NaN
    }
    const small = radiusOf(
      renderFigItem({
        kind: 'geometry',
        width: 120,
        height: 90,
        points: [
          { id: 'A', x: 0, y: 60 },
          { id: 'B', x: 60, y: 60 },
          { id: 'C', x: 30, y: 0 },
        ],
        lines: [
          { from: 'B', to: 'A' },
          { from: 'B', to: 'C' },
        ],
        angles: [{ at: ['A', 'B', 'C'], arcs: 1 }],
      }),
    )
    const large = radiusOf(
      renderFigItem({
        kind: 'geometry',
        width: 600,
        height: 450,
        points: [
          { id: 'A', x: 0, y: 60 },
          { id: 'B', x: 60, y: 60 },
          { id: 'C', x: 30, y: 0 },
        ],
        lines: [
          { from: 'B', to: 'A' },
          { from: 'B', to: 'C' },
        ],
        angles: [{ at: ['A', 'B', 'C'], arcs: 1 }],
      }),
    )
    ok(Number.isFinite(small) && Number.isFinite(large), 'qövs tapılmadı')
    ok(large > small * 1.5, `qövs miqyaslanmır: ${small} → ${large}`)
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

  // Seen live: three of four FEM figures marked their two rays `parallel`, and
  // the fourth marked the same shape `ticks`. Equal-length marks need a finite
  // length to be equal to, so on a ray they cannot mean what they say — and the
  // figure is a transversal, where the mark meant is parallelism. Flagged and
  // not rewritten: converting it would invent a given condition.
  'equal-length ticks on a ray are flagged as a probable parallelism mark'() {
    const q = wireToQuestion({
      stem: 'S',
      figures: [
        {
          kind: 'geometry',
          width: 300,
          height: 200,
          points: [
            { id: 'A', x: 10, y: 20 },
            { id: 'B', x: 280, y: 20 },
            { id: 'C', x: 10, y: 160 },
            { id: 'D', x: 280, y: 160 },
          ],
          lines: [
            { from: 'A', to: 'B', kind: 'ray', ticks: 1 },
            { from: 'C', to: 'D', kind: 'ray', ticks: 1 },
          ],
        },
      ],
    })
    const codes = lintQuestion(q).map((f) => f.code)
    eq(codes.filter((c) => c === 'geo_ticks_on_ray').length, 2, codes.join(','))
  },

  'ticks on a real segment are left alone'() {
    const q = wireToQuestion({
      stem: 'S',
      figures: [
        {
          kind: 'geometry',
          width: 100,
          height: 100,
          points: [
            { id: 'A', x: 10, y: 10 },
            { id: 'B', x: 90, y: 90 },
          ],
          lines: [{ from: 'A', to: 'B', kind: 'segment', ticks: 2 }],
        },
      ],
    })
    notOk(
      lintQuestion(q).some((f) => f.code === 'geo_ticks_on_ray'),
      'parça üçün xəbərdarlıq olmamalıdır',
    )
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

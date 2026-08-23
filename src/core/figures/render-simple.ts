// The four kinds that were HTML.
//
// Tables, division schemes, vertical arithmetic and number lines were rendered
// as flex boxes and `<table>` elements, which is perfectly good for a review
// screen and useless to anything that has to rasterise them. There was nothing
// to port: these are new emitters, not translations.
//
// They share one problem and one solution. The problem is that all four are
// TEXT LAYOUT — the content is a grid of TeX, and SVG has no concept of a cell.
// The solution is to measure every fragment through the injected renderer and
// lay out on the measurements, which is why the renderer must return a size
// and why over-estimating is the safe direction.
import type {
  DivisionScheme,
  NumberLineFig,
  TableFig,
  VerticalArithmetic,
} from '@/core/figures/figspec'
import { hex, num, plainTextRenderer, tag, type TexRenderer } from '@/core/figures/svg-emit'

const SIZE = 13
const PAD = 8
const ROW_GAP = 6

const place = (fragment: { svg: string }, x: number, y: number): string =>
  tag('g', { transform: `translate(${num(x)} ${num(y)})` }, fragment.svg)

const svgWrap = (w: number, h: number, body: string): string =>
  tag(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      viewBox: `0 0 ${num(w)} ${num(h)}`,
      width: Math.ceil(w),
      height: Math.ceil(h),
    },
    body,
  )

const rule = (x1: number, y: number, x2: number, weight = 1.2): string =>
  tag('line', { x1, y1: y, x2, y2: y, stroke: hex('ink'), 'stroke-width': weight })

// ---- table ----

/**
 * A grid, sized to its widest cell per column.
 *
 * Header cells are drawn heavier rather than shaded: a fill has to survive
 * whatever background the figure lands on, and the review screen and a
 * rasterised page are not the same background.
 */
export function renderTable(fig: TableFig, tex: TexRenderer = plainTextRenderer): string {
  const rows = fig.cells ?? []
  if (!rows.length) return svgWrap(40, 20, '')

  const headerRows = fig.headerRows ?? 0
  const headerCols = fig.headerCols ?? 0
  const columns = Math.max(...rows.map((r) => r.length))

  const measured = rows.map((row) =>
    Array.from({ length: columns }, (_, c) => tex(row[c] ?? '', SIZE)),
  )
  const colWidth = Array.from({ length: columns }, (_, c) =>
    Math.max(...measured.map((row) => row[c]?.width ?? 0), 16) + PAD * 2,
  )
  const rowHeight = measured.map(
    (row) => Math.max(...row.map((cell) => cell.height), SIZE) + PAD,
  )

  const width = colWidth.reduce((a, b) => a + b, 0)
  const height = rowHeight.reduce((a, b) => a + b, 0)

  const body: string[] = []
  let y = 0
  for (let r = 0; r < measured.length; r++) {
    let x = 0
    for (let c = 0; c < columns; c++) {
      const cell = measured[r]![c]!
      const isHeader = r < headerRows || c < headerCols
      body.push(
        place(
          isHeader ? { svg: tag('g', { 'font-weight': '600' }, cell.svg) } : cell,
          x + (colWidth[c]! - cell.width) / 2,
          y + (rowHeight[r]! - cell.height) / 2,
        ),
      )
      x += colWidth[c]!
    }
    y += rowHeight[r]!
  }

  // Grid lines drawn after the text so a rule never sits under a glyph.
  let gx = 0
  const verticals: string[] = []
  for (let c = 0; c <= columns; c++) {
    verticals.push(
      tag('line', {
        x1: gx,
        y1: 0,
        x2: gx,
        y2: height,
        stroke: hex('muted'),
        'stroke-width': c === 0 || c === columns || c === headerCols ? 1.2 : 0.7,
      }),
    )
    gx += colWidth[c] ?? 0
  }
  let gy = 0
  const horizontals: string[] = []
  for (let r = 0; r <= measured.length; r++) {
    horizontals.push(
      tag('line', {
        x1: 0,
        y1: gy,
        x2: width,
        y2: gy,
        stroke: hex('muted'),
        'stroke-width': r === 0 || r === measured.length || r === headerRows ? 1.2 : 0.7,
      }),
    )
    gy += rowHeight[r] ?? 0
  }

  return svgWrap(width, height, verticals.join('') + horizontals.join('') + body.join(''))
}

// ---- Turkish division scheme ----

/**
 * The Turkish long-division layout, which is NOT a fraction:
 *
 *     dividend │ divisor
 *     ─────────┼─────────
 *      steps   │ quotient
 *     remainder
 *
 * The vertical bar and the rule under the divisor are the whole notation — a
 * reader who sees a horizontal bar between dividend and divisor reads a
 * fraction and answers a different question.
 */
export function renderDivisionScheme(
  fig: DivisionScheme,
  tex: TexRenderer = plainTextRenderer,
): string {
  const dividend = tex(fig.dividendTex, SIZE)
  const divisor = tex(fig.divisorTex, SIZE)
  const quotient = tex(fig.quotientTex, SIZE)
  const steps = (fig.steps ?? []).map((s) => ({
    label: tex(s.tex, SIZE),
    op: s.op ? tex(s.op, SIZE) : null,
  }))
  const remainder = fig.remainderTex ? tex(fig.remainderTex, SIZE) : null

  const leftWidth =
    Math.max(
      dividend.width,
      ...steps.map((s) => s.label.width + (s.op ? s.op.width + 4 : 0)),
      remainder?.width ?? 0,
    ) + PAD * 2
  const rightWidth = Math.max(divisor.width, quotient.width) + PAD * 2
  const rowH = SIZE + ROW_GAP
  const leftRows = 1 + steps.length + (remainder ? 1 : 0)
  const height = Math.max(leftRows, 2) * rowH + PAD * 2

  const barX = leftWidth
  const body: string[] = [
    // The vertical bar runs the whole height; the divisor's underline stops at
    // the right edge. Together they are the scheme.
    tag('line', {
      x1: barX,
      y1: PAD * 0.5,
      x2: barX,
      y2: height - PAD * 0.5,
      stroke: hex('ink'),
      'stroke-width': 1.4,
    }),
    rule(barX, PAD + rowH - ROW_GAP / 2, barX + rightWidth),
  ]

  body.push(place(dividend, leftWidth - PAD - dividend.width, PAD))
  body.push(place(divisor, barX + PAD, PAD))
  body.push(place(quotient, barX + PAD, PAD + rowH))

  let y = PAD + rowH
  for (const step of steps) {
    if (step.op) body.push(place(step.op, PAD * 0.5, y))
    body.push(place(step.label, leftWidth - PAD - step.label.width, y))
    y += rowH
  }
  if (remainder) {
    body.push(rule(leftWidth - PAD - remainder.width - 6, y - ROW_GAP / 2, leftWidth - PAD))
    body.push(place(remainder, leftWidth - PAD - remainder.width, y))
  }

  return svgWrap(leftWidth + rightWidth, height, body.join(''))
}

// ---- vertical arithmetic ----

/**
 * Digits stacked and right-aligned, the way the book prints them.
 *
 * Right alignment is the content: these are masked-digit puzzles, and a column
 * that does not line up is a different sum. `indent` shifts a partial product
 * left by whole digit positions, so the shift is measured in digit widths
 * rather than pixels.
 */
export function renderVerticalArithmetic(
  fig: VerticalArithmetic,
  tex: TexRenderer = plainTextRenderer,
): string {
  const rows = (fig.rows ?? []).map((r) => ({
    label: tex(r.tex, SIZE),
    op: r.op ? tex(r.op, SIZE) : null,
    indent: r.indent ?? 0,
  }))
  const result = fig.resultTex ? tex(fig.resultTex, SIZE) : null
  if (!rows.length && !result) return svgWrap(40, 20, '')

  const digit = SIZE * 0.62
  const opWidth = Math.max(0, ...rows.map((r) => r.op?.width ?? 0))
  const contentWidth = Math.max(
    ...rows.map((r) => r.label.width + r.indent * digit),
    result?.width ?? 0,
  )
  const rowH = SIZE + ROW_GAP
  const left = PAD + opWidth + 6
  const width = left + contentWidth + PAD
  const right = left + contentWidth
  const height = (rows.length + (result ? 1 : 0)) * rowH + PAD * 2

  const body: string[] = []
  let y = PAD
  rows.forEach((row, index) => {
    if (row.op) body.push(place(row.op, PAD, y))
    body.push(place(row.label, right - row.label.width - row.indent * digit, y))
    if ((fig.hlineAfter ?? []).includes(index)) {
      body.push(rule(PAD, y + rowH - ROW_GAP / 2, right))
    }
    y += rowH
  })
  if (result) body.push(place(result, right - result.width, y))

  return svgWrap(width, height, body.join(''))
}

// ---- number line ----

export function renderNumberLine(
  fig: NumberLineFig,
  tex: TexRenderer = plainTextRenderer,
): string {
  const min = fig.min
  const max = fig.max
  const span = max - min || 1
  const width = 340
  const height = 74
  const axisY = 34
  const inset = 26
  const x = (v: number) => inset + ((v - min) / span) * (width - inset * 2)

  const body: string[] = [
    tag('line', {
      x1: inset - 12,
      y1: axisY,
      x2: width - inset + 12,
      y2: axisY,
      stroke: hex('ink'),
      'stroke-width': 1.4,
      'marker-end': undefined,
    }),
  ]

  // Intervals under the axis, so a filled span never hides a tick label.
  for (const interval of fig.intervals ?? []) {
    const x1 = x(interval.from)
    const x2 = x(interval.to)
    body.push(
      tag('line', {
        x1,
        y1: axisY,
        x2,
        y2: axisY,
        stroke: hex(interval.color, 'primary'),
        'stroke-width': 4,
        'stroke-linecap': 'butt',
        opacity: 0.55,
      }),
    )
    // Open and closed ends are the difference between < and ≤.
    for (const [px, closed] of [
      [x1, interval.closedLeft],
      [x2, interval.closedRight],
    ] as [number, boolean][]) {
      body.push(
        tag('circle', {
          cx: px,
          cy: axisY,
          r: 4,
          fill: closed ? hex(interval.color, 'primary') : '#ffffff',
          stroke: hex(interval.color, 'primary'),
          'stroke-width': 1.5,
        }),
      )
    }
  }

  const labels: string[] = []
  for (const tick of fig.ticks ?? []) {
    const px = x(tick.at)
    body.push(
      tag('line', {
        x1: px,
        y1: axisY - 5,
        x2: px,
        y2: axisY + 5,
        stroke: hex('ink'),
        'stroke-width': 1.2,
      }),
    )
    const fragment = tex(tick.tex, SIZE - 1)
    labels.push(place(fragment, px - fragment.width / 2, axisY + 10))
  }

  for (const point of fig.points ?? []) {
    const px = x(point.at)
    body.push(
      tag('circle', {
        cx: px,
        cy: axisY,
        r: 4.5,
        fill: point.style === 'filled' ? hex('primary') : '#ffffff',
        stroke: hex('primary'),
        'stroke-width': 1.6,
      }),
    )
    if (point.tex) {
      const fragment = tex(point.tex, SIZE - 1)
      labels.push(place(fragment, px - fragment.width / 2, axisY - 22))
    }
  }

  return svgWrap(width, height, body.join('') + labels.join(''))
}

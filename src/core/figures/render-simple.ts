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
import { esc, hex, num, plainTextRenderer, tag, type TexRenderer } from '@/core/figures/svg-emit'

const SIZE = 13
const PAD = 8

/**
 * The typesetter for the arithmetic schemes, and the reason it is not the
 * shared one.
 *
 * The books set these puzzles in an upright SANS with the characters held
 * well apart — `4 5 B`, `+ C A 9` — because the reader's whole job is to see
 * which digit is over which. What we drew was Georgia in the panel and
 * MathJax's italic serif in the worker: two different faces for one figure,
 * neither of them the book's, and letters so tight that a three-character
 * number read as a word.
 *
 * Handled here rather than by changing `plainTextRenderer`, which is right as
 * it is for geometry and graph labels — a variable on an axis SHOULD be
 * italic serif. And handled for BOTH renderers, so the figure the operator
 * approves in the panel is the figure the verification wave rasterises;
 * before this they could not be compared glyph for glyph because they were
 * set in different fonts.
 *
 * Anything with real mathematics in it — `\overline{ab}`, `x^2+3x`, a
 * fraction — is passed to the injected renderer untouched. Those carry
 * meaning that letter-spaced plain text cannot: an overline IS the notation
 * for a multi-digit number, and dropping it changes the question.
 */
const ARITHMETIC_FONT = 'Arial, Helvetica, "DejaVu Sans", sans-serif'
/** Digits and capitals average about this much of the size in either face. */
const SANS_ADVANCE = 0.64
/** The air the book leaves between characters, as a fraction of the size. */
const TRACKING = 0.15
/** Only ordinary characters: no command, no script, no fraction. */
const PLAIN_TEXT = /^[0-9A-Za-z•·.,\s+\-−×÷=()]+$/

function arithmeticText(
  tex: string,
  size: number,
  fallback: TexRenderer,
): { svg: string; width: number; height: number } {
  const text = tex.replace(/\$+/g, '').trim()
  if (!PLAIN_TEXT.test(text)) return fallback(tex, size)
  const chars = [...text].length
  return {
    svg: tag(
      'text',
      {
        x: 0,
        y: num(size * 0.78),
        'font-size': size,
        'font-family': ARITHMETIC_FONT,
        'letter-spacing': num(size * TRACKING),
        fill: 'currentColor',
      },
      esc(text),
    ),
    // The trailing gap is counted in on purpose. Every row carries the same
    // one, so a right-aligned stack still lines up exactly; leaving it out
    // would make the box narrower than the ink and push the last character
    // over the edge it is aligned to.
    width: Math.ceil(chars * size * (SANS_ADVANCE + TRACKING)),
    height: Math.ceil(size * 1.15),
  }
}

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
/**
 * Glyph size for the arithmetic schemes, and it is not the table's.
 *
 * The books print these at about twice the body text, because the figure IS
 * the question — every symbol in it is something the reader has to work with,
 * and half of them are masked. Drawn at the shared 13px the division scheme
 * came out a hundred pixels wide and floated in the figure box like a
 * footnote; the browser shows an SVG at its own declared size and the
 * verification page only ever scales a figure DOWN, so nothing downstream
 * could rescue it.
 *
 * One constant for the long division and the columns, because a book that
 * prints them on facing pages prints them at one size, and a reader who sees
 * two sizes reads two kinds of thing. Exported so the suite can hold both
 * legible.
 */
export const ARITHMETIC_SIZE = 30

export function renderDivisionScheme(
  fig: DivisionScheme,
  tex: TexRenderer = plainTextRenderer,
): string {
  const S = ARITHMETIC_SIZE
  // Spacing in glyph units, so the figure keeps its proportions at any size.
  const gapX = S * 0.6 // dividend → bar, and bar → divisor
  const rowH = S * 1.45
  const rule = S * 0.08 // stroke weight: the book's lines are thin at this scale
  const glyph = (t: string) => arithmeticText(t, S, tex)
  const dividend = glyph(fig.dividendTex)
  const divisor = glyph(fig.divisorTex)
  const quotient = glyph(fig.quotientTex)
  const steps: { label: { svg: string; width: number } | null; op: { svg: string; width: number } | null }[] =
    (fig.steps ?? []).map((s) => ({
      label: glyph(s.tex),
      op: s.op ? glyph(s.op) : null,
    }))
  const remainder = fig.remainderTex ? glyph(fig.remainderTex) : null

  // The books ELIDE the subtraction. Not one of seven live schemes printed the
  // `divisor × quotient` row: each shows the dividend, a `−` at the left of
  // the row beneath it, a rule under that, and the remainder below the rule.
  // So a scheme with a remainder and no steps is not a scheme with nothing
  // between two numbers — it is the book's own form with its middle row left
  // blank, and it is drawn as one: a step whose only content is the minus.
  //
  // It used to draw nothing there, on the reasoning that a rule between the
  // dividend and the remainder reads as a FRACTION. What that produced was
  // `x` over `11` with no mark of any kind, which reads as nothing at all, and
  // the verification wave — comparing pictures — reported the missing `−` and
  // rule on every one of those seven rows. The minus is what makes it not a
  // fraction, and the book prints it every time.
  const elided = !steps.length && !!remainder

  // The elided minus is a STROKE, not a glyph. The two typesetters disagree
  // about what `-` is — the browser's serif prints a hyphen a third of an em
  // wide, MathJax a minus nearly an em — so the same scheme came out with a
  // different mark in the panel and on the verification page, and neither
  // was the book's: a thin bar six tenths of a glyph long, drawn level with
  // the quotient. A line is the same in both and is measured, not guessed.
  const minusLen = S * 0.6
  const minusX = S * 0.3

  // The geometry is the book's, measured off its own crops, in glyph heights:
  //
  //        A │ B          0.6 either side of the bar
  //          ├────        the rule under the divisor, 0.5 past its right edge
  //   −      │ 4          the minus 1.8 left of the dividend, level with the
  //   ───────┘            quotient; the last rule runs from the minus's own
  //        5              left end INTO the bar, and the bar ENDS there
  //
  // Two of those were drawn wrong before and read as a different figure. The
  // bar ran the full height, past the remainder, so the remainder sat beside a
  // bracket it is not inside; and the rule stopped short of the bar, so the
  // two never met. In the book they form a corner, and the corner is the
  // shape a reader recognises as "division" from across the room. The rule's
  // LENGTH is part of that shape too: it starts where the minus starts, well
  // left of the dividend, not a glyph's width before the bar.
  const opWidth = Math.max(elided ? minusLen : 0, ...steps.map((s) => s.op?.width ?? 0))
  const leftInner = Math.max(
    dividend.width,
    ...steps.map((s) => s.label?.width ?? 0),
    remainder?.width ?? 0,
  )
  const leftEdge = minusX + opWidth + S * 1.2 // where the dividend column begins
  const barX = leftEdge + leftInner + gapX
  const rightInner = Math.max(divisor.width, quotient.width)
  const divisorRuleEnd = barX + gapX + rightInner + S * 0.5
  const width = divisorRuleEnd + S * 0.2

  const top = S * 0.3
  const rowY = (i: number) => top + i * rowH
  const centred = (glyph: { width: number }, colStart: number, colWidth: number) =>
    colStart + (colWidth - glyph.width) / 2
  const stroke = { stroke: hex('ink'), 'stroke-width': rule, 'stroke-linecap': 'square' as const }

  const body: string[] = []
  // Row 1: dividend right-aligned against the bar, divisor after it.
  body.push(place(dividend, barX - gapX - dividend.width, rowY(0)))
  body.push(place(divisor, centred(divisor, barX + gapX, rightInner), rowY(0)))
  // The rule under the divisor, and the quotient under that.
  const divisorRuleY = rowY(0) + S * 1.15
  body.push(tag('line', { x1: barX, y1: divisorRuleY, x2: divisorRuleEnd, y2: divisorRuleY, ...stroke }))
  body.push(place(quotient, centred(quotient, barX + gapX, rightInner), rowY(1)))

  // The rule above the remainder, fixed before the rows are placed because the
  // elided minus is positioned off it.
  const stepRows = elided ? 1 : steps.length
  const ruleY = remainder ? rowY(1 + stepRows) - S * 0.3 : null

  // Written subtraction rows on the left: the operator at the far left, the
  // label right-aligned against the bar like the dividend above it.
  let row = 1
  for (const step of steps) {
    if (step.op) body.push(place(step.op, minusX, rowY(row)))
    if (step.label) body.push(place(step.label, barX - gapX - step.label.width, rowY(row)))
    row++
  }
  // The elided row: its minus does not sit on a row of its own — the book
  // prints it level with the quotient, 0.8 above the rule, so `−` and rule
  // read as one mark rather than a stray sign.
  if (elided && ruleY !== null) {
    const y = ruleY - S * 0.8
    body.push(tag('line', { x1: minusX, y1: y, x2: minusX + minusLen, y2: y, ...stroke }))
    row++
  }

  // The last rule and the bar meet at a corner; both end there. The remainder
  // sits a little further under the rule than a row's own pitch gives it —
  // the book leaves 0.7 of a glyph between the two.
  let barBottom = divisorRuleY + rowH // enough to bracket the quotient when nothing follows
  let bottom = rowY(row - 1) + S * 1.15
  if (remainder && ruleY !== null) {
    body.push(tag('line', { x1: minusX, y1: ruleY, x2: barX, y2: ruleY, ...stroke }))
    const remainderY = rowY(row) + S * 0.25
    body.push(place(remainder, centred(remainder, leftEdge, leftInner), remainderY))
    barBottom = ruleY
    bottom = remainderY + S * 1.15
  }
  body.unshift(tag('line', { x1: barX, y1: top, x2: barX, y2: barBottom, ...stroke }))

  const height = Math.max(bottom, barBottom) + S * 0.2
  return svgWrap(width, height, body.join(''))
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
  const S = ARITHMETIC_SIZE
  const glyph = (t: string) => arithmeticText(t, S, tex)
  const rows = (fig.rows ?? []).map((r) => ({
    label: glyph(r.tex),
    op: r.op ? glyph(r.op) : null,
    indent: r.indent ?? 0,
  }))
  const result = fig.resultTex ? glyph(fig.resultTex) : null
  if (!rows.length && !result) return svgWrap(S * 1.4, S * 0.7, '')

  // Everything below is in glyph units, so the figure keeps the book's
  // proportions whatever the size is set to.
  const digit = S * (SANS_ADVANCE + TRACKING) // one column of the right-aligned stack
  const rowH = S * 1.35
  const weight = S * 0.08 // the book's rules are thin at this scale
  const pad = S * 0.3

  const opWidth = Math.max(0, ...rows.map((r) => r.op?.width ?? 0))
  const contentWidth = Math.max(
    ...rows.map((r) => r.label.width + r.indent * digit),
    result?.width ?? 0,
  )
  // The operator sits at the far left with a whole glyph of air after it —
  // the book sets `+` and `×` well clear of the column, not tight against it,
  // and a tight one reads as part of the top number.
  const left = pad + opWidth + S * 0.9
  const right = left + contentWidth
  // The rule runs from the operator's own left edge to just past the digits,
  // which is what makes it the operation's rule rather than an underline
  // under the last number.
  const ruleRight = right + S * 0.15
  const width = ruleRight + pad
  const height = (rows.length + (result ? 1 : 0)) * rowH + pad * 2 - (rowH - S * 1.15)

  const body: string[] = []
  let y = pad
  rows.forEach((row, index) => {
    if (row.op) body.push(place(row.op, pad, y))
    body.push(place(row.label, right - row.label.width - row.indent * digit, y))
    if ((fig.hlineAfter ?? []).includes(index)) {
      body.push(rule(pad, y + S * 1.05, ruleRight, weight))
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

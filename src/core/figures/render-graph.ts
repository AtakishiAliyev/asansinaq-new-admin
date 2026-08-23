// Coordinate planes and the curves on them.
//
// The curve sampling already lives in `core/figures/curve.ts` and is shared
// with lint — the same samples that decide whether a marked point actually
// lies on its curve are the ones drawn here, so a figure cannot pass lint and
// then render differently.
//
// Axes are drawn through the origin when the origin is in view and along the
// edge when it is not, which is what these books do and what makes a plot with
// an all-positive domain readable.
import type { FunctionGraphFig, FunctionGraphPanel, Point } from '@/core/figures/figspec'
import { sampleCurve } from '@/core/figures/curve'
import { clamp, LabelPlacer, type Box, type Seg } from '@/core/figures/layout'
import { hex, num, plainTextRenderer, tag, type TexRenderer } from '@/core/figures/svg-emit'

const SIZE = 12
const PAD = 30
const PANEL_GAP = 24

export function renderFunctionGraph(
  fig: FunctionGraphFig,
  tex: TexRenderer = plainTextRenderer,
): string {
  const panels = fig.panels ?? []
  if (!panels.length) return tag('svg', { xmlns: 'http://www.w3.org/2000/svg', width: 40, height: 20 }, '')

  const rendered = panels.map((panel) => renderPanel(panel, tex))
  const width = rendered.reduce((a, p) => a + p.width, 0) + PANEL_GAP * (rendered.length - 1)
  const height = Math.max(...rendered.map((p) => p.height))

  let x = 0
  const body: string[] = []
  for (const panel of rendered) {
    body.push(tag('g', { transform: `translate(${num(x)} 0)` }, panel.svg))
    x += panel.width + PANEL_GAP
  }

  return tag(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      viewBox: `0 0 ${num(width)} ${num(height)}`,
      width: Math.ceil(width),
      height: Math.ceil(height),
    },
    body.join(''),
  )
}

function renderPanel(
  panel: FunctionGraphPanel,
  tex: TexRenderer,
): { svg: string; width: number; height: number } {
  const plotW = panel.width ?? 240
  const plotH = panel.height ?? 200
  const width = plotW + PAD * 2
  const height = plotH + PAD * 2

  const xs = panel.x
  const ys = panel.y
  const spanX = xs.max - xs.min || 1
  const spanY = ys.max - ys.min || 1
  // y is flipped: the model thinks in maths coordinates, SVG counts downward.
  const px = (v: number) => PAD + ((v - xs.min) / spanX) * plotW
  const py = (v: number) => PAD + plotH - ((v - ys.min) / spanY) * plotH

  // Through the origin when it is in view, along the edge when it is not.
  const axisX = clamp(py(0), PAD, PAD + plotH)
  const axisY = clamp(px(0), PAD, PAD + plotW)

  const body: string[] = []

  if (panel.grid && panel.grid !== 'none') {
    const dash = panel.grid === 'dotted' ? '1 4' : undefined
    for (const tick of xs.ticks ?? []) {
      body.push(
        tag('line', {
          x1: px(tick.at),
          y1: PAD,
          x2: px(tick.at),
          y2: PAD + plotH,
          stroke: hex('muted'),
          'stroke-width': 0.6,
          'stroke-dasharray': dash,
        }),
      )
    }
    for (const tick of ys.ticks ?? []) {
      body.push(
        tag('line', {
          x1: PAD,
          y1: py(tick.at),
          x2: PAD + plotW,
          y2: py(tick.at),
          stroke: hex('muted'),
          'stroke-width': 0.6,
          'stroke-dasharray': dash,
        }),
      )
    }
  }

  const arrow = `arrow-${Math.round(plotW)}x${Math.round(plotH)}`
  body.push(
    tag(
      'defs',
      {},
      tag(
        'marker',
        {
          id: arrow,
          viewBox: '0 0 10 10',
          refX: 8,
          refY: 5,
          markerWidth: 6,
          markerHeight: 6,
          orient: 'auto-start-reverse',
        },
        tag('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: hex('ink') }),
      ),
    ),
  )
  body.push(
    tag('line', {
      x1: PAD - 8,
      y1: axisX,
      x2: PAD + plotW + 10,
      y2: axisX,
      stroke: hex('ink'),
      'stroke-width': 1.3,
      'marker-end': `url(#${arrow})`,
    }),
    tag('line', {
      x1: axisY,
      y1: PAD + plotH + 8,
      x2: axisY,
      y2: PAD - 10,
      stroke: hex('ink'),
      'stroke-width': 1.3,
      'marker-end': `url(#${arrow})`,
    }),
  )

  const strokes: Seg[] = [
    { a: { x: PAD - 8, y: axisX }, b: { x: PAD + plotW + 10, y: axisX } },
    { a: { x: axisY, y: PAD - 10 }, b: { x: axisY, y: PAD + plotH + 8 } },
  ]

  for (const curve of panel.curves ?? []) {
    const sampled = sampleCurve(curve.def)
    if (!sampled.ok || sampled.points.length < 2) continue
    const screen = sampled.points.map(([x, y]) => [px(x), py(y)] as [number, number])
    body.push(
      tag('polyline', {
        points: screen.map((p) => `${num(p[0])},${num(p[1])}`).join(' '),
        fill: 'none',
        stroke: hex(curve.color, 'primary'),
        'stroke-width': 1.8,
        'stroke-linejoin': 'round',
        'stroke-linecap': 'round',
        'marker-end': curve.ends === 'arrow' ? `url(#${arrow})` : undefined,
      }),
    )
    for (let i = 1; i < screen.length; i++) {
      strokes.push({
        a: { x: screen[i - 1]![0], y: screen[i - 1]![1] },
        b: { x: screen[i]![0], y: screen[i]![1] },
      })
    }
  }

  for (const guide of panel.guides ?? []) {
    body.push(
      tag('line', {
        x1: px(guide.from[0]),
        y1: py(guide.from[1]),
        x2: px(guide.to[0]),
        y2: py(guide.to[1]),
        stroke: hex(guide.color, 'guide'),
        'stroke-width': 1.1,
        'stroke-dasharray': '5 4',
      }),
    )
  }

  for (const point of panel.points ?? []) {
    body.push(markPoint(point, px(point.x), py(point.y)))
  }

  // Labels last and placed, like everywhere else: an axis tick that lands on
  // the curve is unreadable, and on a dense plot that happens constantly.
  const placer = new LabelPlacer(strokes, { x: 0, y: 0, w: width, h: height })
  const labels: string[] = []
  const put = (fragment: { svg: string; width: number; height: number }, candidates: Box[]) => {
    const { box } = placer.place(candidates)
    labels.push(tag('g', { transform: `translate(${num(box.x)} ${num(box.y)})` }, fragment.svg))
  }

  for (const tick of xs.ticks ?? []) {
    const at = px(tick.at)
    body.push(
      tag('line', {
        x1: at,
        y1: axisX - 3,
        x2: at,
        y2: axisX + 3,
        stroke: hex('ink'),
        'stroke-width': 1,
      }),
    )
    const fragment = tex(tick.tex, SIZE)
    put(fragment, [
      { x: at - fragment.width / 2, y: axisX + 6, w: fragment.width, h: fragment.height },
      { x: at - fragment.width / 2, y: axisX - 6 - fragment.height, w: fragment.width, h: fragment.height },
    ])
  }
  for (const tick of ys.ticks ?? []) {
    const at = py(tick.at)
    body.push(
      tag('line', {
        x1: axisY - 3,
        y1: at,
        x2: axisY + 3,
        y2: at,
        stroke: hex('ink'),
        'stroke-width': 1,
      }),
    )
    const fragment = tex(tick.tex, SIZE)
    put(fragment, [
      { x: axisY - 8 - fragment.width, y: at - fragment.height / 2, w: fragment.width, h: fragment.height },
      { x: axisY + 8, y: at - fragment.height / 2, w: fragment.width, h: fragment.height },
    ])
  }

  for (const curve of panel.curves ?? []) {
    if (!curve.label) continue
    const fragment = tex(curve.label.tex, SIZE)
    const cx = px(curve.label.at[0])
    const cy = py(curve.label.at[1])
    put(fragment, [
      { x: cx + 8, y: cy - fragment.height - 4, w: fragment.width, h: fragment.height },
      { x: cx + 8, y: cy + 4, w: fragment.width, h: fragment.height },
      { x: cx - fragment.width - 8, y: cy - fragment.height / 2, w: fragment.width, h: fragment.height },
    ])
  }

  for (const point of panel.points ?? []) {
    if (!point.label) continue
    const fragment = tex(point.label, SIZE)
    const cx = px(point.x)
    const cy = py(point.y)
    put(fragment, [
      { x: cx + 7, y: cy - fragment.height - 5, w: fragment.width, h: fragment.height },
      { x: cx - fragment.width - 7, y: cy - fragment.height - 5, w: fragment.width, h: fragment.height },
      { x: cx + 7, y: cy + 5, w: fragment.width, h: fragment.height },
      { x: cx - fragment.width - 7, y: cy + 5, w: fragment.width, h: fragment.height },
    ])
  }

  return { svg: body.join('') + labels.join(''), width, height }
}

/** Filled for "included", hollow for "excluded" — the open/closed convention. */
function markPoint(point: Point, x: number, y: number): string {
  return tag('circle', {
    cx: x,
    cy: y,
    r: 4,
    fill: point.style === 'open' ? '#ffffff' : hex(point.color, 'primary'),
    stroke: hex(point.color, 'primary'),
    'stroke-width': 1.6,
  })
}

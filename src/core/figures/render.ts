// FigSpec → SVG, as a string, with no DOM and no React.
//
// Rendering used to live entirely in React components, which meant the only
// way to see a figure was to mount it in a browser. That is why `eval/README`
// has always said rendering is uncovered, and why the worker cannot check its
// own output: verification needs a picture, and the picture needed a tab.
//
// Two things are deliberately NOT solved here.
//
// Typesetting maths is delegated. Core has no business bundling a TeX engine,
// and the two runtimes want different ones — the browser already has KaTeX
// loaded for the rest of the review screen, and the worker needs something
// that produces self-contained SVG. So the caller injects it, the same way
// `core/segment/crop.ts` injects a canvas factory. The default is deliberately
// crude and honest: an SVG `<text>` node, which is exactly right for the
// labels geometry actually carries (A, B, O, 30°) and visibly wrong for a
// fraction, so nobody mistakes it for typesetting.
//
// Layout across items is the caller's. This returns one `<svg>` per item; the
// review screen stacks them with CSS and the worker composes them onto a page.
import { COLOR_HEX, type ColorToken, type FigItem, type FigureDoc } from '@/core/figures/figspec'
import { toMarkup } from '@/core/figures/svg-safe'

/**
 * TeX in, an SVG fragment and its measured size out.
 *
 * The size is what makes positioning possible: a label anchored `left` has to
 * know how wide it is. A renderer that cannot measure should over-estimate —
 * an overlapping label is a worse failure than a loose one.
 */
export type TexRenderer = (
  tex: string,
  fontSize: number,
) => { svg: string; width: number; height: number }

export interface RenderOptions {
  tex?: TexRenderer
  /**
   * Prefix for every generated id.
   *
   * Ids must be deterministic: the same figure has to render to the same bytes
   * on the worker and in the browser, or a render-and-compare wave would see a
   * difference in every figure and learn nothing from any of them. The old venn
   * renderer used a module-level counter that never reset, so the same document
   * rendered differently depending on what had been rendered before it.
   */
  idPrefix?: string
}

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
}

export function esc(value: string): string {
  return value.replace(/[&<>"']/g, (c) => XML_ESCAPES[c] ?? c)
}

const num = (n: number): string =>
  Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : '0'

function tag(
  name: string,
  attrs: Record<string, string | number | undefined | null>,
  children?: string,
): string {
  const rendered = Object.entries(attrs)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}="${esc(typeof v === 'number' ? num(v) : String(v))}"`)
    .join(' ')
  const open = rendered ? `${name} ${rendered}` : name
  return children === undefined ? `<${open}/>` : `<${open}>${children}</${open}>`
}

const hex = (color: ColorToken | undefined, fallback: ColorToken = 'ink'): string =>
  COLOR_HEX[color ?? fallback]

/**
 * The fallback typesetter: a plain SVG text node.
 *
 * Correct for a single letter or a number with a degree sign, which is what
 * plane geometry labels are. Anything with real structure comes out as its
 * source, which looks wrong on purpose — a silently mangled fraction would be
 * mistaken for a bad read of the source.
 */
export const plainTextRenderer: TexRenderer = (tex, fontSize) => {
  const text = tex.replace(/\$/g, '').trim()
  return {
    svg: tag(
      'text',
      { 'font-size': fontSize, 'font-family': 'serif', fill: 'currentColor' },
      esc(text),
    ),
    // 0.55em per character is a serif average. Over-estimating is the safe
    // direction, so round up.
    width: Math.ceil(text.length * fontSize * 0.55),
    height: Math.ceil(fontSize * 1.2),
  }
}

export type Anchor = 'left' | 'right' | 'above' | 'below'

/** Place a measured label so it sits beside (x, y) rather than on top of it. */
export function placeLabel(
  fragment: { svg: string; width: number; height: number },
  x: number,
  y: number,
  anchor: Anchor = 'above',
  gap = 6,
): string {
  const { width, height } = fragment
  let dx = -width / 2
  let dy = height * 0.35
  if (anchor === 'left') {
    dx = -width - gap
    dy = height * 0.35
  } else if (anchor === 'right') {
    dx = gap
    dy = height * 0.35
  } else if (anchor === 'above') {
    dy = -gap
  } else {
    dy = height + gap * 0.5
  }
  return tag('g', { transform: `translate(${num(x + dx)} ${num(y + dy)})` }, fragment.svg)
}

export { tag, num }

/** One `<svg>` per item, in document order. */
export function renderFigureDoc(doc: FigureDoc, options: RenderOptions = {}): string[] {
  return doc.items.map((item, index) =>
    renderFigItem(item, { ...options, idPrefix: `${options.idPrefix ?? 'fig'}-${index}` }),
  )
}

export function renderFigItem(item: FigItem, options: RenderOptions = {}): string {
  switch (item.kind) {
    case 'geometry':
      return renderGeometry(item, options)
    case 'raw_svg':
      // Already sanitized at the extraction boundary; this only re-serialises
      // the tree we chose to keep.
      return toMarkup(item.node)
    default:
      // Not yet ported. Returning an empty string would look like a figure that
      // rendered to nothing, which is exactly the failure the render lane is
      // supposed to catch — so it says so instead.
      return unsupported(item.kind)
  }
}

function unsupported(kind: string): string {
  return tag(
    'svg',
    { xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 240 40', width: 240, height: 40 },
    tag(
      'text',
      { x: 8, y: 24, 'font-size': 12, 'font-family': 'monospace', fill: COLOR_HEX.muted },
      esc(`${kind}: not renderable outside the browser yet`),
    ),
  )
}

// ---- geometry ----

import type { GeoAngle, GeoLine, GeometryFig, GeoPoint } from '@/core/figures/figspec'

const LABEL_SIZE = 13
const DOT_R = 3
const TICK_LEN = 5
const RIGHT_ANGLE_SIZE = 12
const DEFAULT_ARC_R = 22

interface Vec {
  x: number
  y: number
}

const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y })
const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y })
const scale = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k })
const len = (a: Vec): number => Math.hypot(a.x, a.y) || 1
const unit = (a: Vec): Vec => scale(a, 1 / len(a))
const perp = (a: Vec): Vec => ({ x: -a.y, y: a.x })

/**
 * How far a ray or line runs past its defining points.
 *
 * Generous on purpose: the renderer clips to the viewBox, so overshooting the
 * canvas is free while undershooting leaves a ray that stops in mid-air and
 * reads as a segment — which is a different figure.
 */
const EXTEND = 4000

function renderGeometry(fig: GeometryFig, options: RenderOptions): string {
  const tex = options.tex ?? plainTextRenderer
  const byId = new Map(fig.points.map((p) => [p.id, p]))
  const at = (id: string): Vec | null => {
    const p = byId.get(id)
    return p ? { x: p.x, y: p.y } : null
  }

  const parts: string[] = []

  for (const region of fig.regions ?? []) {
    const pts = region.points.map(at).filter((p): p is Vec => p !== null)
    if (pts.length < 3) continue
    parts.push(
      tag('polygon', {
        points: pts.map((p) => `${num(p.x)},${num(p.y)}`).join(' '),
        fill: hex(region.color, 'muted'),
        'fill-opacity': region.opacity ?? 0.18,
        stroke: 'none',
      }),
    )
  }

  for (const line of fig.lines) parts.push(...renderLine(line, at, tex))
  for (const angle of fig.angles ?? []) parts.push(...renderAngle(angle, at, tex))
  for (const point of fig.points) parts.push(...renderPoint(point, tex))

  return tag(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      viewBox: `0 0 ${num(fig.width)} ${num(fig.height)}`,
      width: fig.width,
      height: fig.height,
      fill: 'none',
      stroke: 'none',
    },
    parts.join(''),
  )
}

function endpointsOf(line: GeoLine, a: Vec, b: Vec): [Vec, Vec] {
  const direction = unit(sub(b, a))
  const kind = line.kind ?? 'segment'
  if (kind === 'segment') return [a, b]
  if (kind === 'ray') return [a, add(a, scale(direction, EXTEND))]
  return [sub(a, scale(direction, EXTEND)), add(b, scale(direction, EXTEND))]
}

function renderLine(
  line: GeoLine,
  at: (id: string) => Vec | null,
  tex: TexRenderer,
): string[] {
  const a = at(line.from)
  const b = at(line.to)
  if (!a || !b) return []
  const [from, to] = endpointsOf(line, a, b)
  const stroke = hex(line.color)
  const out: string[] = [
    tag('line', {
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
      stroke,
      'stroke-width': 1.6,
      'stroke-linecap': 'round',
      'stroke-dasharray': line.dashed ? '6 4' : undefined,
    }),
  ]

  // Marks are placed against the DEFINING points, not the drawn extent: a tick
  // belongs at the midpoint of the segment AB, not halfway along a ray that
  // runs off the canvas.
  const mid = scale(add(a, b), 0.5)
  const direction = unit(sub(b, a))
  const normal = perp(direction)

  if (line.ticks) {
    const spacing = 4
    const first = -((line.ticks - 1) * spacing) / 2
    for (let i = 0; i < line.ticks; i++) {
      const centre = add(mid, scale(direction, first + i * spacing))
      const p1 = add(centre, scale(normal, TICK_LEN))
      const p2 = add(centre, scale(normal, -TICK_LEN))
      out.push(
        tag('line', {
          x1: p1.x,
          y1: p1.y,
          x2: p2.x,
          y2: p2.y,
          stroke,
          'stroke-width': 1.6,
          'stroke-linecap': 'round',
        }),
      )
    }
  }

  if (line.parallel) {
    // Chevrons pointing along the line. Same count on two lines means parallel,
    // so the count is the message and the spacing is only legibility.
    const size = 5
    for (let i = 0; i < line.parallel; i++) {
      const tip = add(mid, scale(direction, i * 5 - ((line.parallel - 1) * 5) / 2 + size / 2))
      const back = add(tip, scale(direction, -size))
      const left = add(back, scale(normal, size * 0.7))
      const right = add(back, scale(normal, -size * 0.7))
      out.push(
        tag('polyline', {
          points: `${num(left.x)},${num(left.y)} ${num(tip.x)},${num(tip.y)} ${num(right.x)},${num(right.y)}`,
          stroke,
          'stroke-width': 1.5,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
          fill: 'none',
        }),
      )
    }
  }

  if (line.label) {
    const anchorPoint = add(mid, scale(normal, -12))
    out.push(placeLabel(tex(line.label, LABEL_SIZE), anchorPoint.x, anchorPoint.y, 'above'))
  }
  return out
}

function renderAngle(
  angle: GeoAngle,
  at: (id: string) => Vec | null,
  tex: TexRenderer,
): string[] {
  const [aId, vId, bId] = angle.at
  const vertex = at(vId)
  const armA = at(aId)
  const armB = at(bId)
  if (!vertex || !armA || !armB) return []

  const u1 = unit(sub(armA, vertex))
  const u2 = unit(sub(armB, vertex))
  const stroke = hex(angle.color)
  const out: string[] = []

  if (angle.right) {
    // The square, not an arc labelled 90°. A reader looking for the square will
    // not accept the arc, and the two are not interchangeable notation.
    const p1 = add(vertex, scale(u1, RIGHT_ANGLE_SIZE))
    const p2 = add(add(vertex, scale(u1, RIGHT_ANGLE_SIZE)), scale(u2, RIGHT_ANGLE_SIZE))
    const p3 = add(vertex, scale(u2, RIGHT_ANGLE_SIZE))
    out.push(
      tag('polyline', {
        points: `${num(p1.x)},${num(p1.y)} ${num(p2.x)},${num(p2.y)} ${num(p3.x)},${num(p3.y)}`,
        stroke,
        'stroke-width': 1.4,
        fill: 'none',
      }),
    )
  }

  const arcs = angle.arcs ?? (angle.right ? 0 : angle.label ? 1 : 0)
  const baseR = angle.radius ?? DEFAULT_ARC_R
  for (let i = 0; i < arcs; i++) {
    const r = baseR + i * 4
    const start = add(vertex, scale(u1, r))
    const end = add(vertex, scale(u2, r))
    // Cross product sign picks the short way round, so the arc lands inside the
    // angle rather than sweeping the reflex side.
    const sweep = u1.x * u2.y - u1.y * u2.x > 0 ? 1 : 0
    out.push(
      tag('path', {
        d: `M ${num(start.x)} ${num(start.y)} A ${num(r)} ${num(r)} 0 0 ${sweep} ${num(end.x)} ${num(end.y)}`,
        stroke,
        'stroke-width': 1.4,
        fill: 'none',
      }),
    )
  }

  if (angle.label) {
    const bisector = unit(add(u1, u2))
    const where = add(vertex, scale(bisector, baseR + 14))
    out.push(placeLabel(tex(angle.label, LABEL_SIZE), where.x, where.y, 'below', 0))
  }
  return out
}

function renderPoint(point: GeoPoint, tex: TexRenderer): string[] {
  const out: string[] = []
  if (point.dot) {
    out.push(
      tag('circle', { cx: point.x, cy: point.y, r: DOT_R, fill: COLOR_HEX.ink, stroke: 'none' }),
    )
  }
  if (point.label) {
    out.push(
      placeLabel(
        tex(point.label, LABEL_SIZE),
        point.x,
        point.y,
        point.labelAnchor ?? 'above',
      ),
    )
  }
  return out
}

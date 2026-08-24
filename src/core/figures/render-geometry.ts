// Plane geometry → SVG.
//
// Three things this does that the first version did not, all of them from
// looking at real FEM figures rather than from taste:
//
//   The cloud is FITTED to the canvas. The model places points on whatever
//   scale it likes, and a figure drawn in a 40px corner has no room for its
//   own labels.
//
//   Marks are sized against the figure, not in absolute pixels. A 22px arc is
//   a neat annotation on a 300px triangle and swallows a 60px one — q9's
//   α arc came out larger than the angle it described.
//
//   Labels are PLACED, not offset. A fixed nudge puts a label wherever the
//   nudge points, which on q10 was directly on top of the ray it belonged to.
//   Every label now looks for room and keeps 8px clear of every stroke and
//   every other label.
import type { GeoAngle, GeoLine, GeometryFig, GeoPoint } from '@/core/figures/figspec'
import {
  add,
  boxAlong,
  clamp,
  clipToBox,
  dist,
  emptiestFirst,
  fitPoints,
  LabelPlacer,
  mid,
  perp,
  scale,
  sub,
  unit,
  type Box,
  type Seg,
  type Vec,
} from '@/core/figures/layout'
import {
  hex,
  num,
  plainTextRenderer,
  tag,
  type TexRenderer,
} from '@/core/figures/svg-emit'

const LABEL_SIZE = 13
const DOT_R = 3

/**
 * How far a ray or line runs past its defining points.
 *
 * Generous, then clipped to the canvas: overshooting is free, while a ray that
 * stops in mid-air reads as a segment, which is a different figure.
 */
const EXTEND = 4000

export interface GeometryLayout {
  svg: string
  /** Where every label landed. Exposed so a test can check they are clear. */
  labels: Box[]
  /** Every visible stroke, clipped to the canvas. */
  strokes: Seg[]
  width: number
  height: number
}

interface DrawnLine {
  spec: GeoLine
  /** The defining points — marks belong here, not on the extended part. */
  from: Vec
  to: Vec
  /** What is actually drawn, after extension. */
  drawn: Seg
}

/**
 * The same fit `layoutGeometry` uses, exposed on its own.
 *
 * The review editor overlays drag handles on the rendered figure, and a handle
 * has to sit exactly where the point was drawn. Recomputing "roughly the cloud
 * bounds" in the editor puts every handle a few pixels off — worse near the
 * edges, where the margin the fit reserves for labels lives — so the reviewer
 * drags a point and it lands somewhere else. One fit, used by both.
 */
export function geometryFit(fig: GeometryFig) {
  return fitPoints(
    fig.points.map((p) => ({ x: p.x, y: p.y })),
    { width: fig.width || 320, height: fig.height || 240 },
  )
}

export function layoutGeometry(
  fig: GeometryFig,
  tex: TexRenderer = plainTextRenderer,
): GeometryLayout {
  const fit = geometryFit(fig)
  const canvas: Box = { x: 0, y: 0, w: fit.width, h: fit.height }
  const at = new Map<string, Vec>()
  for (const p of fig.points) at.set(p.id, fit.to({ x: p.x, y: p.y }))

  // Lines first: everything else is positioned relative to them.
  const lines: DrawnLine[] = []
  for (const spec of fig.lines) {
    const from = at.get(spec.from)
    const to = at.get(spec.to)
    if (!from || !to) continue
    const direction = unit(sub(to, from))
    const kind = spec.kind ?? 'segment'
    const raw: Seg =
      kind === 'segment'
        ? { a: from, b: to }
        : kind === 'ray'
          ? { a: from, b: add(from, scale(direction, EXTEND)) }
          : {
              a: sub(from, scale(direction, EXTEND)),
              b: add(to, scale(direction, EXTEND)),
            }
    const drawn = clipToBox(raw, canvas) ?? raw
    lines.push({ spec, from, to, drawn })
  }

  const strokes = lines.map((l) => l.drawn)
  const placer = new LabelPlacer(strokes, canvas)

  const body: string[] = []

  for (const region of fig.regions ?? []) {
    const pts = region.points.map((id) => at.get(id)).filter((p): p is Vec => !!p)
    if (pts.length < 3) continue
    body.push(
      tag('polygon', {
        points: pts.map((p) => `${num(p.x)},${num(p.y)}`).join(' '),
        fill: hex(region.color, 'muted'),
        'fill-opacity': region.opacity ?? 0.18,
        stroke: 'none',
      }),
    )
  }

  for (const line of lines) body.push(...drawLine(line))
  for (const angle of fig.angles ?? []) body.push(...drawAngle(angle, at))

  for (const point of fig.points) {
    const where = at.get(point.id)
    if (where && point.dot) {
      body.push(
        tag('circle', { cx: where.x, cy: where.y, r: DOT_R, fill: hex('ink'), stroke: 'none' }),
      )
    }
  }

  // Labels last, so they are placed against a drawing that is already complete
  // — and drawn on top of it.
  //
  // Angles first because they are the most constrained: an angle label has one
  // sensible direction (the bisector) and can only move outwards along it,
  // while a point label can go eight ways and a line label two.
  const labels: string[] = []
  for (const angle of fig.angles ?? []) {
    const emitted = placeAngleLabel(angle, at, tex, placer)
    if (emitted) labels.push(emitted)
  }
  for (const point of fig.points) {
    const emitted = placePointLabel(point, at, fig, tex, placer)
    if (emitted) labels.push(emitted)
  }
  for (const line of lines) {
    const emitted = placeLineLabel(line, tex, placer)
    if (emitted) labels.push(emitted)
  }

  const svg = tag(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      viewBox: `0 0 ${num(fit.width)} ${num(fit.height)}`,
      width: fit.width,
      height: fit.height,
      fill: 'none',
      stroke: 'none',
      // Math labels come back from MathJax as `fill="currentColor"`. Without a
      // colour pinned on the root that resolves against whatever page the SVG
      // is dropped into — black in a light one, invisible white-on-white in a
      // dark one. A figure has to look the same everywhere it is opened.
      color: hex('ink'),
    },
    body.join('') + labels.join(''),
  )

  return { svg, labels: placer.boxes(), strokes, width: fit.width, height: fit.height }
}

/** Wrap a measured fragment in a translate to the box's top-left. */
function atBox(fragment: { svg: string }, box: Box): string {
  return tag('g', { transform: `translate(${num(box.x)} ${num(box.y)})` }, fragment.svg)
}

// ---- strokes and marks ----

function drawLine(line: DrawnLine): string[] {
  const { spec, from, to, drawn } = line
  const stroke = hex(spec.color)
  const out = [
    tag('line', {
      x1: drawn.a.x,
      y1: drawn.a.y,
      x2: drawn.b.x,
      y2: drawn.b.y,
      stroke,
      'stroke-width': 1.6,
      'stroke-linecap': 'round',
      'stroke-dasharray': spec.dashed ? '6 4' : undefined,
    }),
  ]

  // Marks sit on the DEFINING span. A tick belongs at the midpoint of AB, not
  // halfway along a ray that runs off the canvas.
  const span = dist(from, to)
  const centre = mid(from, to)
  const direction = unit(sub(to, from))
  const normal = perp(direction)

  if (spec.ticks) {
    // Sized against the edge, so a mark on a short segment stays smaller than
    // the segment it marks.
    const half = clamp(span * 0.07, 3.5, 8)
    const gap = half * 0.9
    const first = -((spec.ticks - 1) * gap) / 2
    for (let i = 0; i < spec.ticks; i++) {
      const c = add(centre, scale(direction, first + i * gap))
      const p1 = add(c, scale(normal, half))
      const p2 = add(c, scale(normal, -half))
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

  if (spec.parallel) {
    const size = clamp(span * 0.05, 3.5, 7)
    const gap = size * 1.1
    const first = -((spec.parallel - 1) * gap) / 2
    for (let i = 0; i < spec.parallel; i++) {
      const tip = add(centre, scale(direction, first + i * gap + size / 2))
      const back = add(tip, scale(direction, -size))
      const left = add(back, scale(normal, size * 0.75))
      const right = add(back, scale(normal, -size * 0.75))
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
  return out
}

/** Arc radius for an angle: a fraction of the SHORTER arm, so it stays inside. */
function arcRadius(angle: GeoAngle, vertex: Vec, armA: Vec, armB: Vec): number {
  const shortest = Math.min(dist(vertex, armA), dist(vertex, armB))
  return angle.radius ?? clamp(shortest * 0.26, 11, 30)
}

function armsOf(
  angle: GeoAngle,
  at: Map<string, Vec>,
): { vertex: Vec; a: Vec; b: Vec } | null {
  const [aId, vId, bId] = angle.at
  const vertex = at.get(vId)
  const a = at.get(aId)
  const b = at.get(bId)
  if (!vertex || !a || !b) return null
  return { vertex, a, b }
}

function drawAngle(angle: GeoAngle, at: Map<string, Vec>): string[] {
  const arms = armsOf(angle, at)
  if (!arms) return []
  const { vertex, a, b } = arms
  const u1 = unit(sub(a, vertex))
  const u2 = unit(sub(b, vertex))
  const stroke = hex(angle.color)
  const out: string[] = []

  if (angle.right) {
    // A square, never an arc labelled 90°: a reader looking for the square
    // does not accept the arc, and the two are not interchangeable notation.
    const size = clamp(Math.min(dist(vertex, a), dist(vertex, b)) * 0.16, 7, 16)
    const p1 = add(vertex, scale(u1, size))
    const p2 = add(add(vertex, scale(u1, size)), scale(u2, size))
    const p3 = add(vertex, scale(u2, size))
    out.push(
      tag('polyline', {
        points: `${num(p1.x)},${num(p1.y)} ${num(p2.x)},${num(p2.y)} ${num(p3.x)},${num(p3.y)}`,
        stroke,
        'stroke-width': 1.4,
        fill: 'none',
      }),
    )
  }

  // Two different things wear an arc, and they must not look the same.
  //
  // An explicit `arcs` count is a CONGRUENCE mark: it claims this angle equals
  // every other angle carrying the same count, and it is usually the whole
  // premise of the question. A labelled angle with no count gets an arc too,
  // but only to show which angle the label belongs to.
  //
  // Drawn identically, an explicit `arcs: 1` was byte-for-byte the same picture
  // as a bare labelled angle — so deleting the congruence claim changed nothing
  // on screen, and the render-and-compare layer could not possibly catch it.
  // A mark that is data has to be visible, or it is no better than a stroke
  // buried in raw_svg. So a congruence mark carries the standard hatch tick
  // across its arcs; the label's anchor arc does not.
  const marked = typeof angle.arcs === 'number' && angle.arcs > 0
  const arcs = angle.arcs ?? (angle.right ? 0 : angle.label ? 1 : 0)
  const base = arcRadius(angle, vertex, a, b)
  for (let i = 0; i < arcs; i++) {
    const r = base + i * clamp(base * 0.18, 3, 6)
    const start = add(vertex, scale(u1, r))
    const end = add(vertex, scale(u2, r))
    // Cross-product sign picks the short way round, so the arc lands inside
    // the angle rather than sweeping the reflex side.
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

  if (marked) {
    // One tick through the middle of the arc bundle, perpendicular to it.
    const outer = base + Math.max(0, arcs - 1) * clamp(base * 0.18, 3, 6)
    const mid = unit(add(u1, u2))
    // Degenerate only if the arms are exactly opposite, where there is no
    // inside to mark.
    if (mid.x !== 0 || mid.y !== 0) {
      const half = clamp(base * 0.16, 2.5, 4.5)
      const centre = add(vertex, scale(mid, (base + outer) / 2))
      const across = perp(mid)
      out.push(
        tag('line', {
          x1: num(centre.x - across.x * half),
          y1: num(centre.y - across.y * half),
          x2: num(centre.x + across.x * half),
          y2: num(centre.y + across.y * half),
          stroke,
          'stroke-width': 1.4,
        }),
      )
    }
  }
  return out
}

// ---- labels ----

function placeAngleLabel(
  angle: GeoAngle,
  at: Map<string, Vec>,
  tex: TexRenderer,
  placer: LabelPlacer,
): string | null {
  if (!angle.label) return null
  const arms = armsOf(angle, at)
  if (!arms) return null
  const { vertex, a, b } = arms
  const fragment = tex(angle.label, LABEL_SIZE)

  const u1 = unit(sub(a, vertex))
  const u2 = unit(sub(b, vertex))
  const bisector = unit(add(u1, u2))
  const arcs = angle.arcs ?? 1
  const base = arcRadius(angle, vertex, a, b)
  // OUTSIDE the outermost arc, along the bisector: that is where a reader
  // looks for an angle's measure, and it is the only direction that does not
  // cross an arm.
  const outer = base + Math.max(0, arcs - 1) * clamp(base * 0.18, 3, 6)

  const rotated = (angleRad: number) =>
    unit({
      x: bisector.x * Math.cos(angleRad) - bisector.y * Math.sin(angleRad),
      y: bisector.x * Math.sin(angleRad) + bisector.y * Math.cos(angleRad),
    })

  // Ordered by DISTANCE first, direction second. Trying every bisector offset
  // before any rotated one pushes a crowded label far up the bisector, where it
  // is clear of everything and no longer obviously belongs to its angle — an
  // angle label 46px out reads as a stray number. A small sideways nudge keeps
  // it near the arc it annotates, which is what a reader looks for.
  const candidates: Box[] = []
  for (const extra of [10, 15, 21, 28, 38]) {
    candidates.push(boxAlong(vertex, bisector, outer + extra, fragment.width, fragment.height))
    for (const rotate of [0.45, -0.45, 0.85, -0.85]) {
      candidates.push(
        boxAlong(vertex, rotated(rotate), outer + extra, fragment.width, fragment.height),
      )
    }
  }

  const { box } = placer.place(candidates)
  return atBox(fragment, box)
}

function placePointLabel(
  point: GeoPoint,
  at: Map<string, Vec>,
  fig: GeometryFig,
  tex: TexRenderer,
  placer: LabelPlacer,
): string | null {
  if (!point.label) return null
  const where = at.get(point.id)
  if (!where) return null
  const fragment = tex(point.label, LABEL_SIZE)

  // The directions the edges at this vertex leave in. The label wants the gap
  // between them, not the top of one.
  const incident: Vec[] = []
  for (const line of fig.lines) {
    if (line.from === point.id) {
      const other = at.get(line.to)
      if (other) incident.push(other)
    } else if (line.to === point.id) {
      const other = at.get(line.from)
      if (other) incident.push(other)
    }
  }

  // An explicit anchor is the author's instruction and is tried first; it is
  // still checked, because an instruction that collides is not an instruction
  // worth following.
  const preferred: Record<string, Vec> = {
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
    above: { x: 0, y: -1 },
    below: { x: 0, y: 1 },
  }
  const order = [
    ...(point.labelAnchor ? [preferred[point.labelAnchor]!] : []),
    ...emptiestFirst(where, incident),
  ]

  const candidates: Box[] = []
  for (const offset of [9, 15, 23]) {
    for (const dir of order) {
      candidates.push(boxAlong(where, dir, offset, fragment.width, fragment.height))
    }
  }

  const { box } = placer.place(candidates)
  return atBox(fragment, box)
}

function placeLineLabel(
  line: DrawnLine,
  tex: TexRenderer,
  placer: LabelPlacer,
): string | null {
  if (!line.spec.label) return null
  const fragment = tex(line.spec.label, LABEL_SIZE)
  const centre = mid(line.from, line.to)
  const normal = perp(unit(sub(line.to, line.from)))

  const candidates: Box[] = []
  // Both sides, increasingly far out. A side label belongs beside its line and
  // the only question is which side has room.
  for (const offset of [11, 18, 27, 38]) {
    candidates.push(boxAlong(centre, normal, offset, fragment.width, fragment.height))
    candidates.push(boxAlong(centre, scale(normal, -1), offset, fragment.width, fragment.height))
  }

  const { box } = placer.place(candidates)
  return atBox(fragment, box)
}


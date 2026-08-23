// Geometry for drawing geometry: fitting a point cloud to a canvas, and
// finding somewhere to put a label where it can actually be read.
//
// Separate from the emitters because every figure kind needs the same two
// things. A venn diagram places region labels, a number line places tick
// labels, a function graph places axis labels — all of them are "put this box
// near this point without landing on a stroke", and all of them got it wrong
// in their own way when each renderer solved it privately.

export interface Vec {
  x: number
  y: number
}

/** Axis-aligned, top-left origin, like everything else in SVG. */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface Seg {
  a: Vec
  b: Vec
}

export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y })
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y })
export const scale = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k })
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y)
export const norm = (a: Vec): number => Math.hypot(a.x, a.y)
export const unit = (a: Vec): Vec => {
  const n = norm(a)
  return n < 1e-9 ? { x: 1, y: 0 } : { x: a.x / n, y: a.y / n }
}
export const perp = (a: Vec): Vec => ({ x: -a.y, y: a.x })
export const mid = (a: Vec, b: Vec): Vec => scale(add(a, b), 0.5)
export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v

// ---- fitting the cloud to the canvas ----

export interface Fit {
  /** Model coordinates → canvas coordinates. */
  to: (p: Vec) => Vec
  width: number
  height: number
  /** How far apart the closest two DISTINCT points ended up, in canvas units. */
  minSeparation: number
  /** A representative edge length, for sizing marks against the figure. */
  scale: number
}

export interface FitOptions {
  width: number
  height: number
  /** Room for labels, which live outside the cloud's own bounds. */
  margin?: number
  /**
   * How far apart the two closest points must end up.
   *
   * The model places points on whatever scale it likes, and a cramped cloud
   * makes every mark and label collide with something. Rather than fight that
   * with cleverer placement, the canvas grows until there is room — the figure
   * is the same figure at any scale, and a bigger SVG costs nothing.
   */
  minSeparation?: number
}

const DEFAULT_MARGIN = 30
const DEFAULT_MIN_SEPARATION = 38

/**
 * Fit a point cloud into a canvas: uniform scale, centred, with margins.
 *
 * Uniform on purpose. Scaling x and y independently would make a right angle
 * stop looking like one and a circle stop being round, and in a geometry figure
 * the shape IS the content.
 */
export function fitPoints(points: Vec[], options: FitOptions): Fit {
  const margin = options.margin ?? DEFAULT_MARGIN
  const minSeparation = options.minSeparation ?? DEFAULT_MIN_SEPARATION

  if (!points.length) {
    return {
      to: (p) => p,
      width: options.width,
      height: options.height,
      minSeparation: 0,
      scale: Math.min(options.width, options.height),
    }
  }

  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const cloudW = maxX - minX
  const cloudH = maxY - minY

  // Closest distinct pair, before scaling. Coincident points are excluded:
  // lint already reports them, and letting a zero separation drive the scale
  // would demand an infinite canvas.
  let closest = Infinity
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = dist(points[i]!, points[j]!)
      if (d > 1e-6 && d < closest) closest = d
    }
  }
  if (!Number.isFinite(closest)) closest = Math.max(cloudW, cloudH, 1)

  const innerW = Math.max(1, options.width - margin * 2)
  const innerH = Math.max(1, options.height - margin * 2)
  const fitScale = Math.min(
    cloudW > 1e-6 ? innerW / cloudW : Infinity,
    cloudH > 1e-6 ? innerH / cloudH : Infinity,
  )
  // A single point, or a perfectly vertical/horizontal cloud, has no finite fit.
  const base = Number.isFinite(fitScale) ? fitScale : 1
  // Grow rather than crowd: the canvas is cheap, legibility is not.
  const k = Math.max(base, minSeparation / closest)

  const width = Math.max(options.width, cloudW * k + margin * 2)
  const height = Math.max(options.height, cloudH * k + margin * 2)
  const offsetX = (width - cloudW * k) / 2
  const offsetY = (height - cloudH * k) / 2

  return {
    to: (p) => ({ x: (p.x - minX) * k + offsetX, y: (p.y - minY) * k + offsetY }),
    width: Math.round(width),
    height: Math.round(height),
    minSeparation: closest * k,
    scale: Math.max(cloudW, cloudH) * k || minSeparation,
  }
}

// ---- collision ----

const pointSegDistance = (p: Vec, s: Seg): number => {
  const d = sub(s.b, s.a)
  const l2 = d.x * d.x + d.y * d.y
  if (l2 < 1e-9) return dist(p, s.a)
  const t = clamp(((p.x - s.a.x) * d.x + (p.y - s.a.y) * d.y) / l2, 0, 1)
  return dist(p, add(s.a, scale(d, t)))
}

const segmentsCross = (p: Seg, q: Seg): boolean => {
  const o = (a: Vec, b: Vec, c: Vec) =>
    Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x))
  const o1 = o(p.a, p.b, q.a)
  const o2 = o(p.a, p.b, q.b)
  const o3 = o(q.a, q.b, p.a)
  const o4 = o(q.a, q.b, p.b)
  return o1 !== o2 && o3 !== o4
}

export const boxEdges = (b: Box): Seg[] => {
  const tl = { x: b.x, y: b.y }
  const tr = { x: b.x + b.w, y: b.y }
  const br = { x: b.x + b.w, y: b.y + b.h }
  const bl = { x: b.x, y: b.y + b.h }
  return [
    { a: tl, b: tr },
    { a: tr, b: br },
    { a: br, b: bl },
    { a: bl, b: tl },
  ]
}

const pointInBox = (p: Vec, b: Box): boolean =>
  p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h

/** 0 when they touch or overlap, otherwise the gap between them. */
export function boxSegDistance(box: Box, seg: Seg): number {
  if (pointInBox(seg.a, box) || pointInBox(seg.b, box)) return 0
  const edges = boxEdges(box)
  if (edges.some((e) => segmentsCross(e, seg))) return 0
  return Math.min(
    ...edges.flatMap((e) => [pointSegDistance(seg.a, e), pointSegDistance(seg.b, e)]),
    pointSegDistance({ x: box.x, y: box.y }, seg),
    pointSegDistance({ x: box.x + box.w, y: box.y }, seg),
    pointSegDistance({ x: box.x + box.w, y: box.y + box.h }, seg),
    pointSegDistance({ x: box.x, y: box.y + box.h }, seg),
  )
}

export function boxDistance(a: Box, b: Box): number {
  const dx = Math.max(0, Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w)))
  const dy = Math.max(0, Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h)))
  return Math.hypot(dx, dy)
}

/** Clip a segment to a rectangle. Null when none of it is inside. */
export function clipToBox(seg: Seg, box: Box): Seg | null {
  // Liang-Barsky.
  let t0 = 0
  let t1 = 1
  const dx = seg.b.x - seg.a.x
  const dy = seg.b.y - seg.a.y
  const tests: [number, number][] = [
    [-dx, seg.a.x - box.x],
    [dx, box.x + box.w - seg.a.x],
    [-dy, seg.a.y - box.y],
    [dy, box.y + box.h - seg.a.y],
  ]
  for (const [p, q] of tests) {
    if (Math.abs(p) < 1e-9) {
      if (q < 0) return null
      continue
    }
    const r = q / p
    if (p < 0) {
      if (r > t1) return null
      if (r > t0) t0 = r
    } else {
      if (r < t0) return null
      if (r < t1) t1 = r
    }
  }
  return {
    a: { x: seg.a.x + t0 * dx, y: seg.a.y + t0 * dy },
    b: { x: seg.a.x + t1 * dx, y: seg.a.y + t1 * dy },
  }
}

// ---- label placement ----

/** The gap a label must keep from every stroke and every other label. */
export const CLEARANCE = 8

export interface Placement {
  box: Box
  /** How much room it actually got. Below CLEARANCE means it was a compromise. */
  clearance: number
}

/**
 * Somewhere to put a box near an anchor without landing on the drawing.
 *
 * Candidates are offered in preference order and the first CLEAR one wins, so
 * a figure with room keeps its conventional label positions. When nothing is
 * clear the roomiest compromise wins rather than the first — a label that must
 * overlap should overlap as little as possible, and it should not silently pick
 * the worst option just because it was listed first.
 */
export class LabelPlacer {
  private readonly placed: Box[] = []
  private readonly strokes: Seg[]
  private readonly bounds: Box

  // Fields assigned in the body rather than declared as constructor
  // parameters: parameter properties emit code, and `erasableSyntaxOnly` keeps
  // every source file strippable so Node can run it with no build step.
  constructor(strokes: Seg[], bounds: Box) {
    this.strokes = strokes
    this.bounds = bounds
  }

  /** Every label placed so far, for tests and for callers that need to inspect. */
  boxes(): Box[] {
    return [...this.placed]
  }

  private clearanceOf(box: Box): number {
    let worst = Infinity
    for (const s of this.strokes) worst = Math.min(worst, boxSegDistance(box, s))
    for (const p of this.placed) worst = Math.min(worst, boxDistance(box, p))
    // Falling off the canvas is its own kind of collision.
    const inset = Math.min(
      box.x - this.bounds.x,
      box.y - this.bounds.y,
      this.bounds.x + this.bounds.w - (box.x + box.w),
      this.bounds.y + this.bounds.h - (box.y + box.h),
    )
    return Math.min(worst, inset < 0 ? inset : Infinity, Infinity)
  }

  place(candidates: Box[]): Placement {
    let best: Placement | null = null
    for (const box of candidates) {
      const clearance = this.clearanceOf(box)
      if (clearance >= CLEARANCE) {
        this.placed.push(box)
        return { box, clearance }
      }
      if (!best || clearance > best.clearance) best = { box, clearance }
    }
    const chosen = best ?? { box: candidates[0]!, clearance: 0 }
    this.placed.push(chosen.box)
    return chosen
  }
}

/** A box of size w×h whose centre sits `offset` away from `anchor` along `dir`. */
export function boxAlong(
  anchor: Vec,
  dir: Vec,
  offset: number,
  w: number,
  h: number,
): Box {
  const u = unit(dir)
  const centre = add(anchor, scale(u, offset + Math.max(w, h) / 2))
  return { x: centre.x - w / 2, y: centre.y - h / 2, w, h }
}

/** The eight compass directions, for "put it wherever there is room". */
export const COMPASS: Vec[] = [
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 },
].map(unit)

/**
 * Order the compass by how empty each direction is around `anchor`.
 *
 * "Emptiest" means furthest from the directions the incident edges leave in:
  * a vertex label belongs in the wedge between its edges, not on top of one.
 */
export function emptiestFirst(anchor: Vec, incident: Vec[]): Vec[] {
  if (!incident.length) return COMPASS
  const dirs = incident.map((p) => unit(sub(p, anchor)))
  return [...COMPASS]
    .map((c) => ({
      c,
      // Worst case matters, not the average: a direction that is far from three
      // edges and on top of the fourth is not a good direction.
      score: Math.min(...dirs.map((d) => 1 - (c.x * d.x + c.y * d.y))),
    }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.c)
}

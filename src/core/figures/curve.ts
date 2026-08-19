import { compile } from 'mathjs'
import type { CurveDef } from '@/core/figures/figspec'

// Monotone cubic (Fritsch–Carlson) interpolation. Unlike Catmull-Rom this never
// overshoots between control points, so a curve declared to peak at y=4 renders
// peaking at exactly 4 — critical when a question's answer depends on the number
// of extrema / crossings.
//
// The only caller gates on xs.length >= 2, so delta holds at least one entry
// and every index below is inside its array.
function monotoneTangents(xs: number[], ys: number[]): number[] {
  const n = xs.length
  const delta: number[] = []
  for (let k = 0; k < n - 1; k++) delta.push((ys[k + 1]! - ys[k]!) / (xs[k + 1]! - xs[k]!))
  const m: number[] = new Array(n)
  m[0] = delta[0]!
  m[n - 1] = delta[n - 2]!
  for (let k = 1; k < n - 1; k++) m[k] = (delta[k - 1]! + delta[k]!) / 2
  for (let k = 0; k < n - 1; k++) {
    if (delta[k] === 0) {
      m[k] = 0
      m[k + 1] = 0
    } else {
      const a = m[k]! / delta[k]!
      const b = m[k + 1]! / delta[k]!
      const s = a * a + b * b
      if (s > 9) {
        const tau = 3 / Math.sqrt(s)
        m[k] = tau * a * delta[k]!
        m[k + 1] = tau * b * delta[k]!
      }
    }
  }
  return m
}

function sampleMonotone(points: [number, number][], samples = 240): [number, number][] {
  const pts = [...points].sort((p, q) => p[0] - q[0])
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  if (xs.length < 2) return pts
  const m = monotoneTangents(xs, ys)
  const out: [number, number][] = []
  for (let k = 0; k < xs.length - 1; k++) {
    const h = xs[k + 1]! - xs[k]!
    const steps = Math.max(2, Math.round(samples / (xs.length - 1)))
    for (let s = 0; s <= steps; s++) {
      const t = s / steps
      const t2 = t * t
      const t3 = t2 * t
      const h00 = 2 * t3 - 3 * t2 + 1
      const h10 = t3 - 2 * t2 + t
      const h01 = -2 * t3 + 3 * t2
      const h11 = t3 - t2
      const y = h00 * ys[k]! + h10 * h * m[k]! + h01 * ys[k + 1]! + h11 * h * m[k + 1]!
      out.push([xs[k]! + t * h, y])
    }
  }
  return out
}

export interface SampledCurve {
  points: [number, number][]
  ok: boolean
  error?: string
}

export function sampleCurve(def: CurveDef): SampledCurve {
  try {
    if (def.type === 'polyline') return { points: def.points, ok: true }
    if (def.type === 'spline') return { points: sampleMonotone(def.points), ok: true }
    // expr — mathjs with x as the only symbol
    const node = compile(def.expr)
    const [a, b] = def.domain
    const N = 240
    const pts: [number, number][] = []
    for (let i = 0; i <= N; i++) {
      const x = a + ((b - a) * i) / N
      const y = node.evaluate({ x })
      if (typeof y === 'number' && Number.isFinite(y)) pts.push([x, y])
    }
    return { points: pts, ok: pts.length > 1 }
  } catch (e) {
    return { points: [], ok: false, error: (e as Error).message }
  }
}

// Lint helper: does every declared point lie on at least one curve (within eps)?
export function pointsLieOnCurves(
  points: [number, number][],
  curves: SampledCurve[],
  eps = 0.35,
): boolean[] {
  return points.map(([px, py]) =>
    curves.some((c) =>
      c.points.some(([cx, cy]) => Math.abs(cx - px) < eps && Math.abs(cy - py) < eps),
    ),
  )
}

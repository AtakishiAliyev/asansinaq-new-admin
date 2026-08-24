import type { SvgNode } from '@/core/figures/svg-safe'

// FigSpec DSL — the declarative "drawing tool" the vision model fills in.
// The AI never draws pixels; it emits one of these typed objects and the
// renderers turn it into exact, watermark-free SVG. Keeping this the single
// source of truth means the AI output contract, DB validation, and the review
// editor all share one schema.

export type ColorToken = 'primary' | 'secondary' | 'guide' | 'ink' | 'muted'

export const COLOR_HEX: Record<ColorToken, string> = {
  primary: '#D33436', // book red
  secondary: '#2A6FDB', // blue
  guide: '#2E9E5B', // green, always dashed guides
  ink: '#1A1A1A',
  muted: '#8A8A8A',
}

// A tick label is free-form TeX so symbolic axis labels survive: "2a", "-a/2",
// "\\frac{1}{2}", "a-b".
export interface Tick {
  at: number
  tex: string
}

export interface Point {
  x: number
  y: number
  style: 'dot' | 'open'
  color?: ColorToken
  label?: string // TeX
  labelAnchor?: 'left' | 'right' | 'above' | 'below'
}

export interface Guide {
  from: [number, number]
  to: [number, number]
  color?: ColorToken
}

export type CurveDef =
  | { type: 'expr'; expr: string; domain: [number, number] } // mathjs, variable x only
  | { type: 'spline'; points: [number, number][] } // monotone cubic through points
  | { type: 'polyline'; points: [number, number][] } // exact segments (V-shapes, zigzags)

export interface Curve {
  id: string
  color: ColorToken
  def: CurveDef
  label?: { tex: string; at: [number, number]; anchor?: 'left' | 'right' | 'above' | 'below' }
  ends?: 'none' | 'arrow'
}

export interface Axis {
  min: number
  max: number
  label?: string
  ticks: Tick[]
}

export interface FunctionGraphPanel {
  x: Axis
  y: Axis
  grid?: 'none' | 'dotted' | 'solid'
  curves: Curve[]
  points?: Point[]
  guides?: Guide[]
  width?: number
  height?: number
}

export interface FunctionGraphFig {
  kind: 'function_graph'
  // Usually one panel; two for side-by-side coordinate planes in one question.
  panels: FunctionGraphPanel[]
}

// ---- Set / Venn diagrams (supports the shaded-region question type) ----

export type VennGeom =
  | { type: 'ellipse'; cx: number; cy: number; rx: number; ry: number; rotate?: number }
  | { type: 'circle'; cx: number; cy: number; r: number }
  | { type: 'triangle'; points: [[number, number], [number, number], [number, number]] }
  | { type: 'rect'; x: number; y: number; w: number; h: number; rx?: number }

export interface VennShape {
  id: string // "A", "B", "C" — referenced by the shaded expressions
  label: string
  labelAt?: [number, number]
  color?: ColorToken
  geom: VennGeom
}

export interface VennFig {
  kind: 'venn'
  width: number
  height: number
  shapes: VennShape[]
  // Each entry is a set-algebra expression over shape ids, e.g. "(A∩B)-C",
  // "A∪B'", "B-(A∪B)". The renderer paints EXACTLY this region via boolean
  // SVG compositing — no eyeballed shading.
  shaded: string[]
  shadeColor?: string // literal hex; defaults to book yellow
  universe?: { label?: string } // draws an enclosing rectangle labelled E when present
  // Content printed INSIDE a region (element lists or counts): the renderer
  // computes the region's centroid from the set expression and places the TeX
  // there — e.g. {expr: "A-B", tex: "2"}, {expr: "A∩B", tex: "1, 2, a"},
  // {expr: "(A∪B)'", tex: "e,f"}. `at` overrides the automatic position.
  regionLabels?: { expr: string; tex: string; at?: [number, number] }[]
}

// ---- Turkish long-division / polynomial-division scheme ----

export interface DivisionScheme {
  kind: 'division_scheme'
  style: 'arithmetic' | 'polynomial'
  dividendTex: string
  divisorTex: string
  quotientTex: string
  steps?: { tex: string; op?: '-' | '+' | null }[]
  remainderTex?: string
}

// ---- Vertical arithmetic (masked-digit questions) ----

export interface VerticalArithmetic {
  kind: 'vertical_arithmetic'
  // Book layout: each printed row top-to-bottom; a row may carry its own
  // operator prefix (× on the multiplier row, + on a shifted partial product).
  rows: { tex: string; op?: '×' | '+' | '−'; indent?: number; masked?: boolean }[]
  hlineAfter?: number[] // rule lines after these row indexes
  resultTex?: string
}

// ---- Plain table (rendered as semantic HTML, never an image) ----

export interface TableFig {
  kind: 'table'
  headerRows?: number
  headerCols?: number
  cells: string[][] // TeX per cell
}

// ---- Number line ----

export interface NumberLineFig {
  kind: 'number_line'
  min: number
  max: number
  ticks: Tick[]
  points?: { at: number; style: 'filled' | 'open'; tex?: string }[]
  intervals?: { from: number; to: number; closedLeft: boolean; closedRight: boolean; color?: ColorToken }[]
}

// ---- Plane geometry ----

// The FEM-style angle and ray figures: a handful of named points, segments and
// rays between them, and — the part that matters — the MARKS.
//
// raw_svg already draws these, and draws the topology correctly. What it drops
// every time is the notation: the double tick that says an angle was bisected,
// the arrowheads that say two lines are parallel, the little square that says
// an angle is right. Those are not decoration, they are the given conditions —
// a bisector figure with the ticks missing is a different problem, usually an
// unsolvable one.
//
// So they are DATA here, not strokes. A mark that is a field can be linted
// against the question, compared between two reads, and drawn correctly at any
// size; a mark that is a `<path>` in a model-authored blob can only be looked
// at by a human.
//
// Coordinates are a plain drawing plane, y DOWN like SVG's, so the model can
// place points the way it sees them.
export interface GeoPoint {
  id: string
  x: number
  y: number
  /** The printed name (A, B, O…). Omit for an unlabelled construction point. */
  label?: string
  labelAnchor?: 'left' | 'right' | 'above' | 'below'
  /** Draw a dot. Vertices usually carry one; ray endpoints usually do not. */
  dot?: boolean
}

/** How far a drawn line extends past the points that define it. */
export type GeoLineKind = 'segment' | 'ray' | 'line'

export interface GeoLine {
  from: string
  to: string
  kind?: GeoLineKind
  color?: ColorToken
  dashed?: boolean
  /**
   * Equal-length ticks: one, two or three cross-hatches at the midpoint. The
   * standard notation for "these sides are the same length", and the reason a
   * reader knows an isosceles triangle is isosceles.
   */
  ticks?: 1 | 2 | 3
  /**
   * Parallelism arrowheads. Lines carrying the same count are parallel — that
   * is the whole convention, so the number is meaningful and not a style.
   */
  parallel?: 1 | 2 | 3
  label?: string
}

export interface GeoAngle {
  /** The three points, in order: the arms and the vertex in the middle. */
  at: [string, string, string]
  /** Printed measure, TeX. "30°", "x", "2\\alpha". */
  label?: string
  /**
   * A right angle is drawn as a square, never as an arc with "90°" — that is
   * the notation, and a reader looking for the square will not accept an arc.
   */
  right?: boolean
  /**
   * Congruent-angle arcs, the angular twin of `ticks`. Two angles marked with
   * the same count are equal, which is how a bisector says it bisects.
   */
  arcs?: 1 | 2 | 3
  color?: ColorToken
  /** Arc radius in plane units. The renderer picks a sane default. */
  radius?: number
}

export interface GeometryFig {
  kind: 'geometry'
  width: number
  height: number
  points: GeoPoint[]
  lines: GeoLine[]
  angles?: GeoAngle[]
  /** Shaded polygons, by point id, for "the shaded region" questions. */
  regions?: { points: string[]; color?: ColorToken; opacity?: number }[]
}

// ---- Isometric cubes ----

/**
 * A row of cubes drawn in the usual isometric three-face view.
 *
 * Its own kind because it is a whole genre of IQ question — cubes coloured by
 * a rule, with the last one partly hidden or lettered — and because the model
 * draws it the same way every time when left to raw_svg: three polygons per
 * cube and a circle on each visible face. Written out as strokes, none of that
 * can be linted, compared or corrected; a face colour that came back wrong is
 * indistinguishable from one the model chose to draw slightly differently.
 * As data it is three fields and a reviewer can fix it in a dropdown.
 *
 * Only the three faces an isometric view can show are modelled. A question
 * about a hidden face asks about something not drawn, which is the point of
 * the question and not something the figure should invent.
 */
export interface CubeFace {
  /** Face fill. Absent means the face is drawn empty. */
  color?: ColorToken | string
  /** A letter or short label written on the face — the "A = ?" cubes. */
  label?: string
  /** A coloured spot on the face, which is how these puzzles usually mark. */
  dot?: ColorToken | string
}

export interface Cube {
  front?: CubeFace
  top?: CubeFace
  right?: CubeFace
}

export interface CubesFig {
  kind: 'cubes'
  cubes: Cube[]
  /** Edge length in plane units. The renderer picks a sane default. */
  size?: number
  /** Gap between cubes, as a fraction of size. */
  gap?: number
}

// ---- Escape hatch ----

/**
 * A region of the ORIGINAL crop, carried through as pixels.
 *
 * This is what an inexpressible figure should become. Left with only raw_svg,
 * a model faced with a figure it cannot draw does not fail loudly — it writes
 * an apology INTO the drawing. One live row came back as a single `<text>`
 * reading "text description not possible, look at the original image", which
 * renders as that sentence where the figure should be, verifies as a
 * catastrophic mismatch, and tells a reviewer nothing they could act on.
 *
 * Cutting the region out of the crop costs nothing, cannot hallucinate, and is
 * the source's own pixels — the same reasoning that already applies to picture
 * options. It is not editable and not lintable, so it always lands in review;
 * that is honest, and strictly better than a drawing of an apology.
 *
 * `src` is a storage path, filled in by the worker after it cuts `box`.
 * `w`/`h` are the natural size of the cut, so it can be drawn undistorted.
 */
export interface ImageFig {
  kind: 'image'
  src: string
  /** Where it sits in the crop: `[ymin, xmin, ymax, xmax]` on a 0-1000 grid. */
  box?: [number, number, number, number]
  w?: number
  h?: number
  note?: string
}

// The escape hatch: a diagram that fits none of the kinds above — an angle
// figure, a labelled construction, an arbitrary schematic. The model writes
// the SVG itself. Stored as the sanitized TREE, never as markup, so nothing
// downstream can be tempted to inject it; see core/figures/svg-safe.ts.
export interface RawSvgFig {
  kind: 'raw_svg'
  node: SvgNode
  /** allowlist rejections, surfaced to the reviewer */
  dropped?: string[]
  note?: string
}

export type FigItem =
  | RawSvgFig
  | GeometryFig
  | CubesFig
  | FunctionGraphFig
  | VennFig
  | DivisionScheme
  | VerticalArithmetic
  | TableFig
  | NumberLineFig
  | ImageFig

export interface FigureDoc {
  v: 1
  layout?: { direction?: 'row' | 'column'; gap?: number }
  items: FigItem[]
}

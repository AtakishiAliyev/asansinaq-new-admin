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

// ---- Escape hatch ----

// AI-regenerated raster figure (image-generation fallback lane). Not editable,
// not lintable — must always pass the side-by-side human review; the reviewer
// is the only guard against subtle detail drift (a label sliding one region).
// `src` is a storage path or a data URL.
export interface ImageFig {
  kind: 'image'
  src: string
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

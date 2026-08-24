// The contract between the vision model and our system: the extracted-question
// types, the LaTeX normalizers that repair model output, and the converter that
// turns the flat wire object (the vision model's responseSchema supports only
// an OpenAPI subset — no oneOf, no tuples) into the strict internal FigureDoc
// the renderers consume.
//
// responseSchema moved to core/extract/schemas.ts

import { sanitizeSvg, svgNodeCount } from '@/core/figures/svg-safe'
import { COLOR_HEX } from '@/core/figures/figspec'
import type {
  ColorToken,
  CubeFace,
  Curve,
  CurveDef,
  FigItem,
  FigureDoc,
  FunctionGraphPanel,
  VennGeom,
} from '@/core/figures/figspec'

// An option is TeX, an image, or (rarely) both — at least one must be present.
// `image` is a storage path or a data URL.
export interface ExtractedOption {
  label: 'A' | 'B' | 'C' | 'D' | 'E'
  tex?: string
  /** resolved image: storage path or data URL (filled by the pipeline) */
  image?: string
  /**
   * The model said this option's CONTENT is a figure. It arrives before any
   * image exists, so lint must not read the empty option as a defect — that
   * would force a paid repair round whose only way to "fix" the option is to
   * invent TeX for a picture.
   */
  isImage?: boolean
  /**
   * Where the picture sits in the source crop: `[ymin, xmin, ymax, xmax]`,
   * normalised to 0-1000.
   *
   * This is how `image` gets filled — the region is cut out of the crop the
   * question came from, which needs no model and costs nothing. Dropping it
   * here is not cosmetic: it is the difference between five picture options and
   * five empty ones, and the row that results looks like a model failure rather
   * than a lost field.
   */
  box?: [number, number, number, number]
}

export interface ExtractedQuestion {
  numberSeen: number
  stem: string
  options: ExtractedOption[]
  figures: FigureDoc | null
  illegible: boolean
  clipped: boolean
  foreign: boolean
  confidence: number
  warnings: string[]
}

// ---- wire → internal ----

// Models sometimes wrap option/label TeX in $...$ despite instructions; the
// renderer supplies math mode itself, so strip the delimiters defensively.
export function stripDollars(s: string): string {
  return s.trim().replace(/^\$+\s*/, '').replace(/\s*\$+$/, '')
}

// "{e,m}" in KaTeX is invisible grouping — the printed set braces disappear.
// If the string contains no LaTeX commands at all, its braces must be literal
// set braces: escape them. (Strings with \frac etc. are left untouched.)
export function normalizeTexField(s: string): string {
  const t = stripDollars(s)
  if (!t.includes('\\') && /[{}]/.test(t)) return t.replace(/([{}])/g, '\\$1')
  return t
}

// Models sometimes cram multi-line stems into ONE $...$ block with literal \n
// as the separator — KaTeX then renders "\nf" as an unknown command. Split the
// math at leaked \n sequences while protecting real LaTeX commands that start
// with n (\neq, \notin, ...).
const KNOWN_N_COMMANDS = new Set([
  'neq', 'ne', 'not', 'notin', 'nmid', 'nleq', 'ngeq', 'nless', 'ngtr',
  'nsubseteq', 'nsupseteq', 'nparallel', 'nexists', 'ncong', 'nsim',
  'nabla', 'nu', 'nearrow', 'nwarrow', 'natural', 'newline',
])

function splitMathOnLeakedNewlines(inner: string): string[] {
  const parts: string[] = []
  let cur = ''
  let i = 0
  while (i < inner.length) {
    const ch = inner[i]
    if (ch === '\\') {
      const m = inner.slice(i + 1).match(/^[a-zA-Z]+/)
      if (m) {
        const word = m[0]
        if (word[0] === 'n' && !KNOWN_N_COMMANDS.has(word)) {
          parts.push(cur)
          cur = word.slice(1) // "\nf(7)" → break, content continues with "f(7)"
          i += 1 + word.length
          continue
        }
        cur += '\\' + word
        i += 1 + word.length
        continue
      }
      cur += ch + (inner[i + 1] ?? '')
      i += 2
      continue
    }
    if (ch === '\n') {
      parts.push(cur)
      cur = ''
      i++
      continue
    }
    cur += ch
    i++
  }
  parts.push(cur)
  return parts.map((p) => p.trim()).filter(Boolean)
}

export function fixLeakedNewlines(stem: string): string {
  const out: string[] = []
  const re = /\$\$([\s\S]+?)\$\$|\$([^$]+)\$/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(stem)) !== null) {
    out.push(stem.slice(last, m.index).replace(/\\n/g, '\n'))
    const display = m[1] !== undefined
    const parts = splitMathOnLeakedNewlines(m[1] ?? m[2]!)
    out.push(parts.map((p) => (display ? `$$${p}$$` : `$${p}$`)).join('\n'))
    last = re.lastIndex
  }
  out.push(stem.slice(last).replace(/\\n/g, '\n'))
  return out.join('')
}

const COLORS: ColorToken[] = ['primary', 'secondary', 'guide', 'ink', 'muted']
const asColor = (c: unknown): ColorToken => (COLORS.includes(c as ColorToken) ? (c as ColorToken) : 'primary')
const xy = (p: { x: number; y: number }): [number, number] => [p.x, p.y]

function wireCurve(w: Record<string, unknown>): Curve {
  const type = w.curve_type as string
  let def: CurveDef
  if (type === 'expr') {
    const dom = (w.domain as number[]) ?? []
    def = { type: 'expr', expr: String(w.expr ?? '0'), domain: [dom[0] ?? -10, dom[1] ?? 10] }
  } else {
    const pts = ((w.points as { x: number; y: number }[]) ?? []).map(xy)
    def = { type: type === 'polyline' ? 'polyline' : 'spline', points: pts }
  }
  const curve: Curve = { id: String(w.id ?? 'f'), color: asColor(w.color), def }
  if (w.label_tex) curve.label = { tex: String(w.label_tex), at: def.type === 'expr' ? [def.domain[1], 0] : (def.points.at(-1) ?? [0, 0]) }
  return curve
}

function wirePanel(w: Record<string, unknown>): FunctionGraphPanel {
  return {
    x: { min: Number(w.x_min), max: Number(w.x_max), ticks: ((w.x_ticks as { at: number; tex: string }[]) ?? []) },
    y: { min: Number(w.y_min), max: Number(w.y_max), ticks: ((w.y_ticks as { at: number; tex: string }[]) ?? []) },
    grid: (w.grid as 'none' | 'dotted' | 'solid') ?? 'none',
    curves: ((w.curves as Record<string, unknown>[]) ?? []).map(wireCurve),
    points: ((w.marks as { x: number; y: number; style: 'dot' | 'open'; label_tex?: string }[]) ?? []).map((m) => ({
      x: m.x,
      y: m.y,
      style: m.style,
      label: m.label_tex,
    })),
    guides: ((w.guides as { from: { x: number; y: number }; to: { x: number; y: number } }[]) ?? []).map((g) => ({
      from: xy(g.from),
      to: xy(g.to),
    })),
  }
}

function wireVennGeom(s: Record<string, unknown>): VennGeom {
  const shape = s.shape as string
  if (shape === 'circle') return { type: 'circle', cx: Number(s.cx), cy: Number(s.cy), r: Number(s.r) }
  if (shape === 'rect') return { type: 'rect', x: Number(s.x), y: Number(s.y), w: Number(s.w), h: Number(s.h), rx: 12 }
  if (shape === 'triangle') {
    const p = ((s.points as { x: number; y: number }[]) ?? []).map(xy)
    return { type: 'triangle', points: [p[0] ?? [0, 0], p[1] ?? [0, 0], p[2] ?? [0, 0]] }
  }
  return { type: 'ellipse', cx: Number(s.cx), cy: Number(s.cy), rx: Number(s.rx ?? 40), ry: Number(s.ry ?? 70), rotate: s.rotate as number | undefined }
}

/** Marks are 1, 2 or 3 — the count IS the meaning (same count = congruent), so
 *  an out-of-range number is clamped rather than dropped. */
function clampMark(value: unknown): 1 | 2 | 3 {
  const n = Math.round(Number(value))
  return (n >= 3 ? 3 : n <= 1 ? 1 : 2) as 1 | 2 | 3
}

const colorish = (value: unknown): string | undefined => {
  const text = typeof value === 'string' ? value.trim() : ''
  return /^#[0-9a-fA-F]{3,8}$/.test(text) || text in COLOR_HEX ? text : undefined
}

function wireFace(value: unknown): CubeFace | undefined {
  if (!value || typeof value !== 'object') return undefined
  const face = value as Record<string, unknown>
  const color = colorish(face.color)
  const dot = colorish(face.dot)
  const label = typeof face.label === 'string' && face.label.trim() ? face.label.trim() : undefined
  // A face object with nothing in it says the face is visible and blank, which
  // is a real state — but only when the model actually sent the object.
  return color || dot || label ? { ...(color ? { color } : {}), ...(dot ? { dot } : {}), ...(label ? { label } : {}) } : {}
}

/** `[ymin, xmin, ymax, xmax]` on a 0-1000 grid, or nothing. */
function wireBox(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4) return null
  const nums = value.map((n) => Math.round(Number(n)))
  if (nums.some((n) => !Number.isFinite(n) || n < 0 || n > 1000)) return null
  const [ymin, xmin, ymax, xmax] = nums as [number, number, number, number]
  // A zero-area or inverted box would cut nothing; better to have no figure
  // than an empty one that looks like a successful cut.
  if (ymax <= ymin || xmax <= xmin) return null
  return [ymin, xmin, ymax, xmax]
}

function wireFigure(w: Record<string, unknown>): FigItem | null {
  const kind = w.kind as string
  switch (kind) {
    case 'raw_svg': {
      // Sanitized at the boundary, not at render time: after this point the
      // figure is a checked tree, and no later caller can accidentally
      // reintroduce the markup it came from.
      const { node, dropped } = sanitizeSvg(String(w.raw_svg ?? ''))
      if (!node || svgNodeCount(node) < 2) return null
      return {
        kind: 'raw_svg',
        node,
        ...(dropped.length ? { dropped } : {}),
        ...(w.note ? { note: String(w.note) } : {}),
      }
    }
    case 'cubes': {
      const cubes = ((w.cubes as Record<string, unknown>[]) ?? [])
        .map((c) => ({
          ...(wireFace(c.front) ? { front: wireFace(c.front) } : {}),
          ...(wireFace(c.top) ? { top: wireFace(c.top) } : {}),
          ...(wireFace(c.right) ? { right: wireFace(c.right) } : {}),
        }))
        // A cube with no visible face is not a cube, and an empty row is not a
        // figure — both mean the model picked the kind and then had nothing to
        // put in it, which must not read as a successfully structured figure.
        .filter((c) => c.front || c.top || c.right)
      if (!cubes.length) return null
      return {
        kind: 'cubes',
        cubes,
        ...(Number(w.size) > 0 ? { size: Number(w.size) } : {}),
      }
    }
    case 'image': {
      const box = wireBox(w.box)
      // No box means no pixels to cut, and an image figure with neither src nor
      // box would render as an empty frame. Dropped, so the row reports as
      // having no figure rather than as having a blank one.
      if (!box) return null
      return {
        kind: 'image',
        // Filled in by the worker once the region is cut and stored.
        src: '',
        box,
        ...(w.note ? { note: String(w.note) } : {}),
      }
    }
    case 'geometry': {
      const points = ((w.points as Record<string, unknown>[]) ?? [])
        .map((p) => ({
          id: String(p.id ?? ''),
          x: Number(p.x ?? 0),
          y: Number(p.y ?? 0),
          ...(p.label != null ? { label: String(p.label) } : {}),
          ...(p.label_anchor != null
            ? { labelAnchor: p.label_anchor as 'left' | 'right' | 'above' | 'below' }
            : {}),
          ...(p.dot ? { dot: true } : {}),
        }))
        .filter((p) => p.id !== '')
      // A line between points that were never declared draws from (0,0) — a
      // stray stroke across the figure that reads as part of the construction.
      const known = new Set(points.map((p) => p.id))
      const lines = ((w.lines as Record<string, unknown>[]) ?? [])
        .map((l) => ({
          from: String(l.from ?? ''),
          to: String(l.to ?? ''),
          ...(l.kind ? { kind: l.kind as 'segment' | 'ray' | 'line' } : {}),
          ...(l.color ? { color: l.color as ColorToken } : {}),
          ...(l.dashed ? { dashed: true } : {}),
          ...(l.ticks ? { ticks: clampMark(l.ticks) } : {}),
          ...(l.parallel ? { parallel: clampMark(l.parallel) } : {}),
          ...(l.label != null ? { label: String(l.label) } : {}),
        }))
        // Both endpoints must exist AND differ: a line from a point to itself
        // is zero length, draws nothing, and its ticks land on a single pixel.
        .filter((l) => l.from !== l.to && known.has(l.from) && known.has(l.to))
      const angles = ((w.angles as Record<string, unknown>[]) ?? [])
        .map((a) => {
          const at = ((a.at as string[]) ?? []).map(String)
          return {
            at: [at[0] ?? '', at[1] ?? '', at[2] ?? ''] as [string, string, string],
            ...(a.label != null ? { label: String(a.label) } : {}),
            ...(a.right ? { right: true } : {}),
            ...(a.arcs ? { arcs: clampMark(a.arcs) } : {}),
            ...(a.color ? { color: a.color as ColorToken } : {}),
            ...(a.radius != null ? { radius: Number(a.radius) } : {}),
          }
        })
        .filter((a) => a.at.every((id) => known.has(id)))
      if (!points.length || (!lines.length && !angles.length)) return null
      return {
        kind: 'geometry',
        width: Number(w.width ?? 320),
        height: Number(w.height ?? 240),
        points,
        lines,
        ...(angles.length ? { angles } : {}),
        ...(Array.isArray(w.regions)
          ? {
              regions: (w.regions as Record<string, unknown>[])
                .map((r) => ({
                  points: ((r.points as string[]) ?? []).map(String),
                  ...(r.color ? { color: r.color as ColorToken } : {}),
                  ...(r.opacity != null ? { opacity: Number(r.opacity) } : {}),
                }))
                .filter((r) => r.points.length >= 3 && r.points.every((id) => known.has(id))),
            }
          : {}),
      }
    }
    case 'function_graph':
      return { kind: 'function_graph', panels: ((w.panels as Record<string, unknown>[]) ?? []).map(wirePanel) }
    case 'venn':
      return {
        kind: 'venn',
        width: Number(w.venn_width ?? 300),
        height: Number(w.venn_height ?? 230),
        shapes: ((w.venn_shapes as Record<string, unknown>[]) ?? []).map((s) => ({
          id: String(s.id),
          label: String(s.label),
          color: asColor(s.color),
          geom: wireVennGeom(s),
        })),
        shaded: (w.shaded as string[]) ?? [],
        shadeColor: w.shade_color as string | undefined,
        universe: w.universe_label ? { label: String(w.universe_label) } : undefined,
        regionLabels: ((w.region_labels as { expr: string; tex: string }[]) ?? []).map((r) => ({
          expr: String(r.expr),
          tex: normalizeTexField(String(r.tex)),
        })),
      }
    case 'division_scheme': {
      const d = (w.division as Record<string, unknown>) ?? {}
      return {
        kind: 'division_scheme',
        style: (d.style as 'arithmetic' | 'polynomial') ?? 'arithmetic',
        dividendTex: String(d.dividend_tex ?? ''),
        divisorTex: String(d.divisor_tex ?? ''),
        quotientTex: String(d.quotient_tex ?? ''),
        remainderTex: d.remainder_tex as string | undefined,
      }
    }
    case 'vertical_arithmetic': {
      const v = (w.vertical as Record<string, unknown>) ?? {}
      return {
        kind: 'vertical_arithmetic',
        rows: ((v.rows as { tex: string; op?: '×' | '+' | '−'; indent?: number }[]) ?? []),
        hlineAfter: (v.hline_after as number[]) ?? [],
        resultTex: v.result_tex as string | undefined,
      }
    }
    case 'table': {
      const t = (w.table as Record<string, unknown>) ?? {}
      return { kind: 'table', headerRows: Number(t.header_rows ?? 0), headerCols: Number(t.header_cols ?? 0), cells: (t.cells as string[][]) ?? [] }
    }
    case 'number_line': {
      const n = (w.number_line as Record<string, unknown>) ?? {}
      return { kind: 'number_line', min: Number(n.min ?? 0), max: Number(n.max ?? 10), ticks: (n.ticks as { at: number; tex: string }[]) ?? [] }
    }
    default:
      return null
  }
}

// Models sometimes split ONE diagram into several venn items (shapes in one,
// region labels in another) despite instructions — merge them back together.
function mergeVennItems(items: FigItem[]): FigItem[] {
  const venns = items.filter((i): i is Extract<FigItem, { kind: 'venn' }> => i.kind === 'venn')
  if (venns.length <= 1) return items
  const merged: Extract<FigItem, { kind: 'venn' }> = {
    kind: 'venn',
    width: Math.max(...venns.map((v) => v.width)),
    height: Math.max(...venns.map((v) => v.height)),
    shapes: venns.flatMap((v) => v.shapes).filter((s, i, arr) => arr.findIndex((x) => x.id === s.id) === i),
    shaded: venns.flatMap((v) => v.shaded),
    shadeColor: venns.find((v) => v.shadeColor)?.shadeColor,
    universe: venns.find((v) => v.universe)?.universe,
    regionLabels: venns.flatMap((v) => v.regionLabels ?? []),
  }
  return [merged, ...items.filter((i) => i.kind !== 'venn')]
}

// Region exprs reference sets by the PRINTED name (A, K, II...). If the model
// invented different internal ids, remap each shape's id to its label so the
// exprs resolve. Labels up to 4 letters (Roman numerals) qualify.
function normalizeVennShapeIds(items: FigItem[]): void {
  for (const it of items) {
    if (it.kind !== 'venn') continue
    const taken = new Set(it.shapes.map((s) => s.id))
    for (const s of it.shapes) {
      const label = s.label.trim()
      if (/^[A-Za-z]{1,4}$/.test(label) && s.id !== label && !taken.has(label)) {
        taken.delete(s.id)
        s.id = label
        taken.add(label)
      }
    }
  }
}

// Decide, from the ALREADY-EXTRACTED figure, whether a B&W scheme is too complex
// for reliable DSL and should be redrawn as raster instead. Reliable because it
// inspects real content, not pixels: masked-digit cryptarithms (bullets) and
// multi-scheme layouts are exactly where DSL drops rows / jumbles columns.
export function isComplexSchemeFigure(doc: FigureDoc | null): boolean {
  if (!doc) return false
  const schemes = doc.items.filter((i) => i.kind === 'vertical_arithmetic' || i.kind === 'division_scheme')
  if (!schemes.length) return false
  // Two or more figures side by side (e.g. multiplication + division).
  if (doc.items.length >= 2) return true
  const hasBullet = (s: string) => /[•●∙·]/.test(s)
  for (const it of doc.items) {
    if (it.kind === 'vertical_arithmetic') {
      if (it.rows.some((r) => r.masked || hasBullet(r.tex)) || hasBullet(it.resultTex ?? '')) return true
    }
    if (it.kind === 'division_scheme') {
      if (hasBullet(it.dividendTex + it.divisorTex + it.quotientTex + (it.remainderTex ?? ''))) return true
      if ((it.steps ?? []).some((s) => hasBullet(s.tex))) return true
    }
  }
  return false
}

/**
 * A usable `[ymin, xmin, ymax, xmax]`. The schema cannot say "tuple of four" —
 * it is an array of numbers — so the shape is checked here, and a degenerate
 * box (zero width or height, or reversed edges) is rejected rather than passed
 * on to become a zero-pixel crop.
 */
function isBox(value: unknown): value is [number, number, number, number] {
  if (!Array.isArray(value) || value.length !== 4) return false
  if (!value.every((n) => typeof n === 'number' && Number.isFinite(n))) return false
  const [ymin, xmin, ymax, xmax] = value as [number, number, number, number]
  return ymax > ymin && xmax > xmin
}

export function wireToQuestion(raw: Record<string, unknown>): ExtractedQuestion {
  const figuresWire = (raw.figures as Record<string, unknown>[]) ?? []
  const items = mergeVennItems(figuresWire.map(wireFigure).filter((x): x is FigItem => x !== null))
  normalizeVennShapeIds(items)
  return {
    numberSeen: Number(raw.number_seen ?? 0),
    stem: fixLeakedNewlines(String(raw.stem ?? '')),
    options: ((raw.options as ExtractedOption[]) ?? []).map((o) => {
      const opt: ExtractedOption = { label: o.label }
      if (o.tex != null) opt.tex = normalizeTexField(String(o.tex))
      if (o.image != null) opt.image = o.image
      if ((o as { is_image?: boolean }).is_image) opt.isImage = true
      const box = (o as { box?: unknown }).box
      if (isBox(box)) opt.box = box
      return opt
    }),
    figures: items.length ? { v: 1, items } : null,
    illegible: Boolean(raw.illegible),
    clipped: Boolean(raw.clipped),
    foreign: Boolean(raw.foreign),
    confidence: Number(raw.confidence ?? 0),
    warnings: (raw.warnings as string[]) ?? [],
  }
}

/** Which figure lane a question runs, after the model has answered. */
export type FigureLane = 'plain' | 'dsl' | 'raster'

/**
 * Picks the lane from what the model returned, not from what the pixels
 * predicted.
 *
 * `figureMode` is a guess made by the crop classifier before the question was
 * read, and on plane geometry it is wrong in both directions: a plain
 * black-and-white drawing has neither colour nor a long horizontal rule, so it
 * reads as `plain`, while a bare diagram of straight strokes reads as `dsl`
 * and is handed to a vector vocabulary that cannot express an arbitrary angle
 * figure. The second mistake was the silent one — the vector lane with no spec
 * to render simply did nothing, and a question whose entire subject is a
 * picture reached review without one.
 *
 * So the answer decides: a figure spec is rendered, a reported figure box is
 * redrawn, and only when the model offers neither is there genuinely nothing
 * to draw.
 */
export function chooseFigureLane(input: {
  /** what the crop classifier guessed */
  figureMode: FigureLane
  /** the model returned a renderable figure spec */
  hasDslFigures: boolean
  /** the model reported where the drawing sits in the crop */
  hasFigureBox: boolean
}): FigureLane {
  // Colour is the one signal the classifier is reliable about, and the vector
  // vocabulary has no colour: trust it over anything the model says.
  if (input.figureMode === 'raster') return 'raster'
  if (input.hasDslFigures) return 'dsl'
  if (input.hasFigureBox) return 'raster'
  return 'plain'
}

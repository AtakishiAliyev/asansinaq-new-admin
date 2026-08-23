// Venn diagrams, where the shading is COMPUTED rather than drawn.
//
// The model writes a set expression — `(A∩B)-C` — and the renderer paints
// exactly that region by compiling the expression into a chain of SVG masks:
// intersection is nested masks, union is two white paints, complement inverts,
// and `a − b` is `a ∩ ¬b`. Nothing here eyeballs a shape and shades what looks
// about right, which matters because "the shaded region" IS the question and a
// region that is approximately correct is wrong.
//
// Ported out of React with one behavioural change: mask ids are derived from
// the figure's position in the document instead of a module-level counter that
// never reset. The counter meant the same diagram serialised differently
// depending on what had been rendered before it — invisible on screen, fatal
// to a render-and-compare wave, which would have seen a difference in every
// figure and learned nothing from any.
import type { VennFig, VennGeom, VennShape } from '@/core/figures/figspec'
import { parseSetExpr, type SetAst } from '@/core/figures/set-expr'
import { LabelPlacer, type Box, type Seg } from '@/core/figures/layout'
import { hex, num, plainTextRenderer, tag, type TexRenderer } from '@/core/figures/svg-emit'

const LABEL_SIZE = 13
const DEFAULT_SHADE = '#F2C744'

// ---- membership, for placing region labels ----

function pointInGeom(g: VennGeom, x: number, y: number): boolean {
  switch (g.type) {
    case 'circle': {
      const dx = x - g.cx
      const dy = y - g.cy
      return dx * dx + dy * dy <= g.r * g.r
    }
    case 'ellipse': {
      const th = ((g.rotate ?? 0) * Math.PI) / 180
      const dx = x - g.cx
      const dy = y - g.cy
      const lx = dx * Math.cos(-th) - dy * Math.sin(-th)
      const ly = dx * Math.sin(-th) + dy * Math.cos(-th)
      return (lx * lx) / (g.rx * g.rx) + (ly * ly) / (g.ry * g.ry) <= 1
    }
    case 'rect':
      return x >= g.x && x <= g.x + g.w && y >= g.y && y <= g.y + g.h
    case 'triangle': {
      const [[x1, y1], [x2, y2], [x3, y3]] = g.points
      const d1 = (x - x2) * (y1 - y2) - (x1 - x2) * (y - y2)
      const d2 = (x - x3) * (y2 - y3) - (x2 - x3) * (y - y3)
      const d3 = (x - x1) * (y3 - y1) - (x3 - x1) * (y - y1)
      return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))
    }
  }
}

function pointInRegion(
  ast: SetAst,
  x: number,
  y: number,
  shapeById: (id: string) => VennShape | undefined,
): boolean {
  switch (ast.t) {
    case 'set': {
      const s = shapeById(ast.id)
      return s ? pointInGeom(s.geom, x, y) : false
    }
    case 'compl':
      return !pointInRegion(ast.a, x, y, shapeById)
    case 'inter':
      return pointInRegion(ast.a, x, y, shapeById) && pointInRegion(ast.b, x, y, shapeById)
    case 'union':
      return pointInRegion(ast.a, x, y, shapeById) || pointInRegion(ast.b, x, y, shapeById)
    case 'diff':
      return pointInRegion(ast.a, x, y, shapeById) && !pointInRegion(ast.b, x, y, shapeById)
  }
}

/**
 * Where to print a region's contents: the centroid of its member samples.
 *
 * A centroid can fall OUTSIDE its own region when the region is not convex —
 * a complement ring is the usual case, and its centroid sits in the hole. So
 * the centroid is tested for membership, and the nearest member sample is used
 * when it fails.
 */
function regionAnchor(
  ast: SetAst,
  w: number,
  h: number,
  shapeById: (id: string) => VennShape | undefined,
): [number, number] | null {
  const step = 6
  const pts: [number, number][] = []
  for (let x = 8; x <= w - 8; x += step) {
    for (let y = 8; y <= h - 8; y += step) {
      if (pointInRegion(ast, x, y, shapeById)) pts.push([x, y])
    }
  }
  if (!pts.length) return null
  let cx = 0
  let cy = 0
  for (const [x, y] of pts) {
    cx += x
    cy += y
  }
  cx /= pts.length
  cy /= pts.length
  if (pointInRegion(ast, cx, cy, shapeById)) return [cx, cy]
  let best = pts[0]!
  let bestD = Infinity
  for (const p of pts) {
    const d = (p[0] - cx) ** 2 + (p[1] - cy) ** 2
    if (d < bestD) {
      bestD = d
      best = p
    }
  }
  return best
}

// ---- drawing ----

function geomTag(geom: VennGeom, attrs: Record<string, string | number>): string {
  switch (geom.type) {
    case 'ellipse':
      return tag('ellipse', {
        cx: geom.cx,
        cy: geom.cy,
        rx: geom.rx,
        ry: geom.ry,
        transform: geom.rotate ? `rotate(${num(geom.rotate)} ${num(geom.cx)} ${num(geom.cy)})` : undefined,
        ...attrs,
      })
    case 'circle':
      return tag('circle', { cx: geom.cx, cy: geom.cy, r: geom.r, ...attrs })
    case 'rect':
      return tag('rect', {
        x: geom.x,
        y: geom.y,
        width: geom.w,
        height: geom.h,
        rx: geom.rx,
        ...attrs,
      })
    case 'triangle':
      return tag('polygon', {
        points: geom.points.map((p) => `${num(p[0])},${num(p[1])}`).join(' '),
        ...attrs,
      })
  }
}

/** Outline of the shape, for keeping region labels off the strokes. */
function geomOutline(geom: VennGeom): Seg[] {
  const ring = (pts: [number, number][]): Seg[] =>
    pts.map((p, i) => {
      const q = pts[(i + 1) % pts.length]!
      return { a: { x: p[0], y: p[1] }, b: { x: q[0], y: q[1] } }
    })
  switch (geom.type) {
    case 'rect':
      return ring([
        [geom.x, geom.y],
        [geom.x + geom.w, geom.y],
        [geom.x + geom.w, geom.y + geom.h],
        [geom.x, geom.y + geom.h],
      ])
    case 'triangle':
      return ring(geom.points)
    default: {
      // Circles and ellipses approximated as a 24-gon: enough for a clearance
      // test, and far cheaper than exact conic-to-box distance.
      const { cx, cy } = geom
      const rx = geom.type === 'circle' ? geom.r : geom.rx
      const ry = geom.type === 'circle' ? geom.r : geom.ry
      const rot = geom.type === 'ellipse' ? ((geom.rotate ?? 0) * Math.PI) / 180 : 0
      const pts: [number, number][] = []
      for (let i = 0; i < 24; i++) {
        const t = (i / 24) * Math.PI * 2
        const lx = Math.cos(t) * rx
        const ly = Math.sin(t) * ry
        pts.push([
          cx + lx * Math.cos(rot) - ly * Math.sin(rot),
          cy + lx * Math.sin(rot) + ly * Math.cos(rot),
        ])
      }
      return ring(pts)
    }
  }
}

interface MaskBuilder {
  defs: string[]
  next: number
  prefix: string
}

const cover = (w: number, h: number, fill: string): string =>
  tag('rect', { x: 0, y: 0, width: w, height: h, fill })

/** Compile a set expression into nested masks. Returns the outermost mask id. */
function compileMask(
  ast: SetAst,
  shapeById: (id: string) => VennShape | undefined,
  w: number,
  h: number,
  builder: MaskBuilder,
): string {
  const id = `${builder.prefix}-m${builder.next++}`
  const maskAttrs = { id, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: w, height: h }

  const push = (body: string) => builder.defs.push(tag('mask', maskAttrs, body))

  switch (ast.t) {
    case 'set': {
      const shape = shapeById(ast.id)
      if (!shape) throw new Error(`Çoxluq "${ast.id}" fiqurda təyin olunmayıb`)
      push(geomTag(shape.geom, { fill: 'white' }))
      break
    }
    case 'compl': {
      const a = compileMask(ast.a, shapeById, w, h, builder)
      push(cover(w, h, 'white') + tag('g', { mask: `url(#${a})` }, cover(w, h, 'black')))
      break
    }
    case 'inter': {
      const a = compileMask(ast.a, shapeById, w, h, builder)
      const b = compileMask(ast.b, shapeById, w, h, builder)
      push(
        tag(
          'g',
          { mask: `url(#${b})` },
          tag('g', { mask: `url(#${a})` }, cover(w, h, 'white')),
        ),
      )
      break
    }
    case 'union': {
      const a = compileMask(ast.a, shapeById, w, h, builder)
      const b = compileMask(ast.b, shapeById, w, h, builder)
      push(
        tag('g', { mask: `url(#${a})` }, cover(w, h, 'white')) +
          tag('g', { mask: `url(#${b})` }, cover(w, h, 'white')),
      )
      break
    }
    case 'diff': {
      // a − b == a ∩ ¬b
      const a = compileMask(ast.a, shapeById, w, h, builder)
      const nb = compileMask({ t: 'compl', a: ast.b }, shapeById, w, h, builder)
      push(
        tag(
          'g',
          { mask: `url(#${nb})` },
          tag('g', { mask: `url(#${a})` }, cover(w, h, 'white')),
        ),
      )
      break
    }
  }
  return id
}

export function renderVenn(
  fig: VennFig,
  tex: TexRenderer = plainTextRenderer,
  idPrefix = 'venn',
): string {
  const w = fig.width || 300
  const h = fig.height || 230
  const shapeById = (id: string) => fig.shapes.find((s) => s.id === id)
  const builder: MaskBuilder = { defs: [], next: 0, prefix: idPrefix }

  const shaded: string[] = []
  for (const expr of fig.shaded ?? []) {
    // Compiled into a SCRATCH builder and merged only on success. A chain is
    // built inside-out, so a set that turns out to be undefined throws after
    // its siblings have already been emitted — merging as we went would leave
    // orphan masks in <defs> for a region that is never painted.
    const scratch: MaskBuilder = { defs: [], next: builder.next, prefix: builder.prefix }
    try {
      const id = compileMask(parseSetExpr(expr), shapeById, w, h, scratch)
      builder.defs.push(...scratch.defs)
      builder.next = scratch.next
      shaded.push(
        tag('g', { mask: `url(#${id})` }, cover(w, h, fig.shadeColor ?? DEFAULT_SHADE)),
      )
    } catch {
      // A region that cannot be compiled is left unshaded rather than shaded
      // wrongly. lint already reports the expression, and a convincing wrong
      // region answers a different question than the one printed.
    }
  }

  const body: string[] = []
  if (fig.universe) {
    body.push(
      tag('rect', {
        x: 4,
        y: 4,
        width: w - 8,
        height: h - 8,
        fill: 'none',
        stroke: hex('muted'),
        'stroke-width': 1.2,
      }),
    )
  }
  body.push(...shaded)
  for (const shape of fig.shapes) {
    body.push(
      geomTag(shape.geom, {
        fill: 'none',
        stroke: hex(shape.color, 'ink'),
        'stroke-width': 1.6,
      }),
    )
  }

  // Labels: the set names, then whatever is printed inside the regions.
  const strokes = fig.shapes.flatMap((s) => geomOutline(s.geom))
  const placer = new LabelPlacer(strokes, { x: 0, y: 0, w, h })
  const labels: string[] = []

  const put = (fragment: { svg: string; width: number; height: number }, cx: number, cy: number) => {
    const centred: Box = {
      x: cx - fragment.width / 2,
      y: cy - fragment.height / 2,
      w: fragment.width,
      h: fragment.height,
    }
    // Region contents belong at the anchor. Nudge outward only if the anchor
    // is unusable — a label that has wandered out of its own region is worse
    // than one sitting close to a stroke.
    const { box } = placer.place([
      centred,
      { ...centred, y: centred.y - 10 },
      { ...centred, y: centred.y + 10 },
      { ...centred, x: centred.x - 12 },
      { ...centred, x: centred.x + 12 },
    ])
    labels.push(tag('g', { transform: `translate(${num(box.x)} ${num(box.y)})` }, fragment.svg))
  }

  for (const shape of fig.shapes) {
    const fragment = tex(shape.label, LABEL_SIZE)
    const [lx, ly] = shape.labelAt ?? defaultLabelAt(shape.geom)
    put(fragment, lx, ly)
  }

  for (const region of fig.regionLabels ?? []) {
    let at = region.at
    if (!at) {
      try {
        at = regionAnchor(parseSetExpr(region.expr), w, h, shapeById) ?? undefined
      } catch {
        at = undefined
      }
    }
    if (!at) continue
    put(tex(region.tex, LABEL_SIZE), at[0], at[1])
  }

  if (fig.universe?.label) {
    labels.push(
      tag(
        'g',
        { transform: `translate(10 ${num(h - 10)})` },
        tex(fig.universe.label, LABEL_SIZE).svg,
      ),
    )
  }

  const defs = builder.defs.length ? tag('defs', {}, builder.defs.join('')) : ''
  return tag(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      viewBox: `0 0 ${num(w)} ${num(h)}`,
      width: w,
      height: h,
    },
    defs + body.join('') + labels.join(''),
  )
}

/** Just outside the top of the shape, which is where these books print it. */
function defaultLabelAt(geom: VennGeom): [number, number] {
  switch (geom.type) {
    case 'circle':
      return [geom.cx, geom.cy - geom.r - 10]
    case 'ellipse':
      return [geom.cx, geom.cy - geom.ry - 10]
    case 'rect':
      return [geom.x + geom.w / 2, geom.y - 10]
    case 'triangle': {
      const xs = geom.points.map((p) => p[0])
      const ys = geom.points.map((p) => p[1])
      return [(Math.min(...xs) + Math.max(...xs)) / 2, Math.min(...ys) - 10]
    }
  }
}


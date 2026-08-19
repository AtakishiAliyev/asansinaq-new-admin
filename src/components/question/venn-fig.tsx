import type { ReactNode } from 'react'
import { COLOR_HEX, type VennFig, type VennGeom, type VennShape } from '@/core/figures/figspec'
import { parseSetExpr, type SetAst } from '@/core/figures/set-expr'
import { FigLabel } from './fig-label'

// ---- geometric membership tests (for region-label placement) ----

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
      const neg = d1 < 0 || d2 < 0 || d3 < 0
      const pos = d1 > 0 || d2 > 0 || d3 > 0
      return !(neg && pos)
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

// Approximate placement point for a region: centroid of member samples; if the
// centroid itself falls outside the region (non-convex regions like a
// complement ring), fall back to the member sample nearest to the centroid.
function regionAnchor(
  ast: SetAst,
  W: number,
  H: number,
  shapeById: (id: string) => VennShape | undefined,
): [number, number] | null {
  const step = 6
  const pts: [number, number][] = []
  for (let x = 8; x <= W - 8; x += step)
    for (let y = 8; y <= H - 8; y += step) if (pointInRegion(ast, x, y, shapeById)) pts.push([x, y])
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
  // pts is non-empty — the emptiness check above already returned.
  let best: [number, number] = pts[0]!
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

// Render one geometry primitive as an SVG element with the given paint.
function geomEl(geom: VennGeom, props: Record<string, unknown>, key?: string): ReactNode {
  switch (geom.type) {
    case 'ellipse':
      return (
        <ellipse
          key={key}
          cx={geom.cx}
          cy={geom.cy}
          rx={geom.rx}
          ry={geom.ry}
          transform={geom.rotate ? `rotate(${geom.rotate} ${geom.cx} ${geom.cy})` : undefined}
          {...props}
        />
      )
    case 'circle':
      return <circle key={key} cx={geom.cx} cy={geom.cy} r={geom.r} {...props} />
    case 'rect':
      return <rect key={key} x={geom.x} y={geom.y} width={geom.w} height={geom.h} rx={geom.rx} {...props} />
    case 'triangle':
      return <polygon key={key} points={geom.points.map((p) => p.join(',')).join(' ')} {...props} />
  }
}

// Compile a set-algebra AST into a chain of SVG <mask> defs whose luminance is
// white exactly on the region's members. Intersection = nested masks, union =
// two white paints, complement = invert, difference = a ∩ ¬b.
function compileMask(
  ast: SetAst,
  shapeById: (id: string) => VennShape | undefined,
  W: number,
  H: number,
  prefix: string,
  ctr: { n: number },
  defs: ReactNode[],
): string {
  const id = `${prefix}-m${ctr.n++}`
  const cover = (fill: string) => <rect x={0} y={0} width={W} height={H} fill={fill} />

  switch (ast.t) {
    case 'set': {
      const shape = shapeById(ast.id)
      if (!shape) throw new Error(`Çoxluq "${ast.id}" fiqurda təyin olunmayıb`)
      defs.push(
        <mask key={id} id={id} maskUnits="userSpaceOnUse" x={0} y={0} width={W} height={H}>
          {geomEl(shape.geom, { fill: 'white' })}
        </mask>,
      )
      break
    }
    case 'compl': {
      const a = compileMask(ast.a, shapeById, W, H, prefix, ctr, defs)
      defs.push(
        <mask key={id} id={id} maskUnits="userSpaceOnUse" x={0} y={0} width={W} height={H}>
          {cover('white')}
          <g mask={`url(#${a})`}>{cover('black')}</g>
        </mask>,
      )
      break
    }
    case 'inter': {
      const a = compileMask(ast.a, shapeById, W, H, prefix, ctr, defs)
      const b = compileMask(ast.b, shapeById, W, H, prefix, ctr, defs)
      defs.push(
        <mask key={id} id={id} maskUnits="userSpaceOnUse" x={0} y={0} width={W} height={H}>
          <g mask={`url(#${b})`}>
            <g mask={`url(#${a})`}>{cover('white')}</g>
          </g>
        </mask>,
      )
      break
    }
    case 'union': {
      const a = compileMask(ast.a, shapeById, W, H, prefix, ctr, defs)
      const b = compileMask(ast.b, shapeById, W, H, prefix, ctr, defs)
      defs.push(
        <mask key={id} id={id} maskUnits="userSpaceOnUse" x={0} y={0} width={W} height={H}>
          <g mask={`url(#${a})`}>{cover('white')}</g>
          <g mask={`url(#${b})`}>{cover('white')}</g>
        </mask>,
      )
      break
    }
    case 'diff': {
      // a − b  ==  a ∩ ¬b
      const a = compileMask(ast.a, shapeById, W, H, prefix, ctr, defs)
      const nb = compileMask({ t: 'compl', a: ast.b }, shapeById, W, H, prefix, ctr, defs)
      defs.push(
        <mask key={id} id={id} maskUnits="userSpaceOnUse" x={0} y={0} width={W} height={H}>
          <g mask={`url(#${nb})`}>
            <g mask={`url(#${a})`}>{cover('white')}</g>
          </g>
        </mask>,
      )
      break
    }
  }
  return id
}

let vennSeq = 0

export function VennFigView({ fig }: { fig: VennFig }) {
  const { width: W, height: H } = fig
  const prefix = `venn${vennSeq++}`
  const shapeById = (id: string) => fig.shapes.find((s) => s.id === id)
  const shadeColor = fig.shadeColor ?? '#F5D400'

  const defs: ReactNode[] = []
  const shadeFills: ReactNode[] = []
  const ctr = { n: 0 }

  fig.shaded.forEach((expr, i) => {
    try {
      const ast = parseSetExpr(expr)
      const maskId = compileMask(ast, shapeById, W, H, prefix, ctr, defs)
      shadeFills.push(
        <rect key={`sh${i}`} x={0} y={0} width={W} height={H} fill={shadeColor} mask={`url(#${maskId})`} />,
      )
    } catch (e) {
      shadeFills.push(
        <text key={`err${i}`} x={8} y={16 + i * 14} fill="#c0392b" fontSize={11}>
          {`Ştrixləmə xətası: ${(e as Error).message}`}
        </text>,
      )
    }
  })

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img">
      <defs>{defs}</defs>
      {fig.universe && (
        <rect x={4} y={4} width={W - 8} height={H - 8} fill="none" stroke={COLOR_HEX.ink} strokeWidth={1.5} />
      )}
      {/* shaded regions under the outlines */}
      {shadeFills}
      {/* shape outlines */}
      {fig.shapes.map((s, i) =>
        geomEl(
          s.geom,
          { fill: 'none', stroke: COLOR_HEX[s.color ?? 'secondary'], strokeWidth: 2 },
          `outline${i}`,
        ),
      )}
      {/* labels */}
      {fig.universe?.label && <FigLabel x={W - 16} y={18} tex={fig.universe.label} anchor="left" />}
      {fig.shapes.map((s, i) => {
        const at = s.labelAt ?? defaultLabelPos(s.geom, W)
        return <FigLabel key={`lbl${i}`} x={at[0]} y={at[1]} tex={s.label} anchor="center" color={s.color} />
      })}
      {/* region contents (counts / element lists) at computed region anchors */}
      {(fig.regionLabels ?? []).map((rl, i) => {
        try {
          const ast = parseSetExpr(rl.expr)
          const at = rl.at ?? regionAnchor(ast, W, H, shapeById)
          if (!at) return null
          return <FigLabel key={`rl${i}`} x={at[0]} y={at[1]} tex={rl.tex} anchor="center" size={13} />
        } catch {
          return (
            <text key={`rlerr${i}`} x={8} y={H - 8 - i * 14} fill="#c0392b" fontSize={11}>
              {`Bölgə ifadəsi xətası: ${rl.expr}`}
            </text>
          )
        }
      })}
    </svg>
  )
}

// Default label spot: just OUTSIDE the shape's top edge, nudged away from the
// canvas centre so two overlapping circles get labels on opposite sides.
function defaultLabelPos(geom: VennGeom, canvasW: number): [number, number] {
  switch (geom.type) {
    case 'ellipse': {
      const side = geom.cx <= canvasW / 2 ? -0.5 : 0.5
      return [geom.cx + geom.rx * side, Math.max(12, geom.cy - geom.ry - 14)]
    }
    case 'circle': {
      const side = geom.cx <= canvasW / 2 ? -0.5 : 0.5
      return [geom.cx + geom.r * side, Math.max(12, geom.cy - geom.r - 14)]
    }
    case 'rect':
      return [geom.x + geom.w + 6, geom.y + geom.h / 2]
    case 'triangle': {
      const top = geom.points.reduce((a, b) => (b[1] < a[1] ? b : a))
      return [top[0] + 6, top[1] - 4]
    }
  }
}

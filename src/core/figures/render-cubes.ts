// A row of isometric cubes → SVG.
//
// The proportions are taken from what the model already draws when it is left
// to raw_svg, rather than chosen: a front face slightly taller than it is wide,
// and a depth offset of about a third of the edge, up and to the right. Copying
// the shape it converged on means the structured kind renders as the same
// picture the unstructured one did, so adopting it does not itself look like a
// change to the figure.
import type { Cube, CubeFace, CubesFig } from '@/core/figures/figspec'
import { COLOR_HEX, type ColorToken } from '@/core/figures/figspec'
import { esc, num, tag, type TexRenderer } from '@/core/figures/svg-emit'

const DEFAULT_SIZE = 70
const DEFAULT_GAP = 0.85
/** Depth as a fraction of the edge. */
const DEPTH = 0.35
/** The front face is drawn a little taller than wide, as these puzzles print. */
const TALL = 1.14
const LABEL_SIZE = 15

interface Vec {
  x: number
  y: number
}

const pts = (points: Vec[]): string =>
  points.map((p) => `${num(p.x)},${num(p.y)}`).join(' ')

/**
 * A face colour.
 *
 * Both a palette token and a literal colour are accepted: the tokens carry
 * meaning elsewhere in the DSL, but these puzzles turn on colours that are just
 * colours — a red spot is not a "primary" one — and forcing them through a
 * five-token vocabulary would either lose distinctions the question depends on
 * or quietly recolour the figure.
 */
function fill(value: string | undefined, fallback: string): string {
  if (!value) return fallback
  if (value in COLOR_HEX) return COLOR_HEX[value as ColorToken]
  return /^#[0-9a-fA-F]{3,8}$/.test(value) ? value : fallback
}

function faceBody(
  face: CubeFace | undefined,
  corners: Vec[],
  centre: Vec,
  tex: TexRenderer,
  scale: number,
): string[] {
  const out: string[] = [
    tag('polygon', {
      points: pts(corners),
      fill: fill(face?.color, '#ffffff'),
      stroke: COLOR_HEX.ink,
      'stroke-width': 1.4,
      'stroke-linejoin': 'round',
    }),
  ]
  if (!face) return out

  if (face.dot) {
    out.push(
      tag('circle', {
        cx: num(centre.x),
        cy: num(centre.y),
        r: num(scale * 0.14),
        fill: fill(face.dot, COLOR_HEX.ink),
        stroke: COLOR_HEX.ink,
        'stroke-width': 1,
      }),
    )
  }

  if (face.label) {
    const fragment = tex(face.label, LABEL_SIZE)
    out.push(
      tag(
        'g',
        {
          transform: `translate(${num(centre.x - fragment.width / 2)} ${num(
            centre.y - fragment.height / 2,
          )})`,
        },
        fragment.svg,
      ),
    )
  }
  return out
}

function drawCube(cube: Cube, x: number, y: number, size: number, tex: TexRenderer): string[] {
  const w = size
  const h = size * TALL
  const d = size * DEPTH
  // Up and to the right, which is the projection these puzzles are printed in.
  const off: Vec = { x: d, y: -d }

  const frontCorners: Vec[] = [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ]
  const topCorners: Vec[] = [
    { x, y },
    { x: x + off.x, y: y + off.y },
    { x: x + w + off.x, y: y + off.y },
    { x: x + w, y },
  ]
  const rightCorners: Vec[] = [
    { x: x + w, y },
    { x: x + w + off.x, y: y + off.y },
    { x: x + w + off.x, y: y + h + off.y },
    { x: x + w, y: y + h },
  ]

  return [
    // Top and right first so the front face's outline sits over their edges,
    // which is what makes the solid read as a solid.
    ...faceBody(
      cube.top,
      topCorners,
      { x: x + w / 2 + off.x / 2, y: y + off.y / 2 },
      tex,
      size,
    ),
    ...faceBody(
      cube.right,
      rightCorners,
      { x: x + w + off.x / 2, y: y + h / 2 + off.y / 2 },
      tex,
      size,
    ),
    ...faceBody(cube.front, frontCorners, { x: x + w / 2, y: y + h / 2 }, tex, size),
  ]
}

export function renderCubes(fig: CubesFig, tex: TexRenderer): string {
  const size = fig.size && fig.size > 0 ? fig.size : DEFAULT_SIZE
  const gap = (fig.gap ?? DEFAULT_GAP) * size
  const d = size * DEPTH
  const h = size * TALL

  const pad = Math.max(10, size * 0.18)
  const stride = size + gap
  const width = Math.ceil(pad * 2 + Math.max(1, fig.cubes.length) * stride - gap + d)
  const height = Math.ceil(pad * 2 + h + d)
  // The top face rises by `d`, so the origin sits that far down from the pad.
  const baseY = pad + d

  const body: string[] = []
  for (const [index, cube] of fig.cubes.entries()) {
    body.push(...drawCube(cube, pad + index * stride, baseY, size, tex))
  }

  return tag(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      viewBox: `0 0 ${width} ${height}`,
      width,
      height,
      fill: 'none',
      stroke: 'none',
      // MathJax face labels come back as `currentColor`; without this they
      // resolve against whatever page the figure is dropped into.
      color: COLOR_HEX.ink,
    },
    body.join(''),
  )
}

/** Only used by the fallback path, kept beside the renderer it belongs to. */
export const cubesSummary = (fig: CubesFig): string =>
  esc(`${fig.cubes.length} kub`)

import { COLOR_HEX, type ColorToken } from '@/core/figures/figspec'
import { Tex } from './tex'

// A KaTeX label positioned at an SVG coordinate via <foreignObject>.
// anchor controls which side of (x,y) the label sits on.
export function FigLabel({
  x,
  y,
  tex,
  anchor = 'right',
  color,
  size = 14,
}: {
  x: number
  y: number
  tex: string
  anchor?: 'left' | 'right' | 'above' | 'below' | 'center'
  color?: ColorToken
  size?: number
}) {
  const w = Math.max(24, tex.length * 10 + 14)
  const h = size + 10
  let fx = x
  let fy = y - h / 2
  if (anchor === 'left') fx = x
  if (anchor === 'right') fx = x - w
  if (anchor === 'above') {
    fx = x - w / 2
    fy = y - h
  }
  if (anchor === 'below') {
    fx = x - w / 2
    fy = y
  }
  if (anchor === 'center') fx = x - w / 2
  return (
    <foreignObject x={fx} y={fy} width={w} height={h} style={{ overflow: 'visible' }}>
      <div
        className="leading-none whitespace-nowrap"
        style={{
          fontSize: size,
          color: color ? COLOR_HEX[color] : COLOR_HEX.ink,
          textAlign:
            anchor === 'right'
              ? 'right'
              : anchor === 'center' || anchor === 'above' || anchor === 'below'
                ? 'center'
                : 'left',
        }}
      >
        <Tex tex={tex} />
      </div>
    </foreignObject>
  )
}

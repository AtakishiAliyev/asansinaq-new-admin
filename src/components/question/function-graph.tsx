import type { ReactElement } from 'react'
import { COLOR_HEX, type FunctionGraphFig, type FunctionGraphPanel } from '@/core/figures/figspec'
import { sampleCurve } from '@/core/figures/curve'
import { FigLabel } from './fig-label'

const PAD = 26 // px padding around the plotting area for axis labels

function Panel({ panel }: { panel: FunctionGraphPanel }) {
  const W = panel.width ?? 300
  const H = panel.height ?? 230
  const { x: ax, y: ay } = panel
  const plotW = W - 2 * PAD
  const plotH = H - 2 * PAD

  // graph → svg pixel transforms
  const sx = (gx: number) => PAD + ((gx - ax.min) / (ax.max - ax.min)) * plotW
  const sy = (gy: number) => PAD + (1 - (gy - ay.min) / (ay.max - ay.min)) * plotH

  const originX = ax.min <= 0 && ax.max >= 0 ? sx(0) : sx(ax.min)
  const originY = ay.min <= 0 && ay.max >= 0 ? sy(0) : sy(ay.min)

  const gridDots: ReactElement[] = []
  if (panel.grid === 'dotted') {
    for (let gx = Math.ceil(ax.min); gx <= Math.floor(ax.max); gx++)
      for (let gy = Math.ceil(ay.min); gy <= Math.floor(ay.max); gy++)
        gridDots.push(<circle key={`d${gx}_${gy}`} cx={sx(gx)} cy={sy(gy)} r={1} fill={COLOR_HEX.muted} />)
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img">
      <defs>
        <marker id="arrow" markerWidth={8} markerHeight={8} refX={6} refY={3} orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill={COLOR_HEX.ink} />
        </marker>
      </defs>

      {panel.grid === 'dotted' && gridDots}

      {/* axes with arrowheads */}
      <line
        x1={sx(ax.min)}
        y1={originY}
        x2={sx(ax.max)}
        y2={originY}
        stroke={COLOR_HEX.ink}
        strokeWidth={1.2}
        markerEnd="url(#arrow)"
      />
      <line
        x1={originX}
        y1={sy(ay.min)}
        x2={originX}
        y2={sy(ay.max)}
        stroke={COLOR_HEX.ink}
        strokeWidth={1.2}
        markerEnd="url(#arrow)"
      />

      {/* ticks + labels */}
      {ax.ticks.map((t, i) => (
        <g key={`xt${i}`}>
          <line x1={sx(t.at)} y1={originY - 3} x2={sx(t.at)} y2={originY + 3} stroke={COLOR_HEX.ink} />
          <FigLabel x={sx(t.at)} y={originY + 12} tex={t.tex} anchor="below" size={12} />
        </g>
      ))}
      {ay.ticks.map((t, i) => (
        <g key={`yt${i}`}>
          <line x1={originX - 3} y1={sy(t.at)} x2={originX + 3} y2={sy(t.at)} stroke={COLOR_HEX.ink} />
          <FigLabel x={originX - 8} y={sy(t.at)} tex={t.tex} anchor="right" size={12} />
        </g>
      ))}

      {/* guides (dashed) */}
      {(panel.guides ?? []).map((g, i) => (
        <line
          key={`g${i}`}
          x1={sx(g.from[0])}
          y1={sy(g.from[1])}
          x2={sx(g.to[0])}
          y2={sy(g.to[1])}
          stroke={COLOR_HEX[g.color ?? 'guide']}
          strokeWidth={1}
          strokeDasharray="5 4"
        />
      ))}

      {/* curves */}
      {panel.curves.map((c, i) => {
        const s = sampleCurve(c.def)
        if (!s.ok || s.points.length < 2) {
          return (
            <text key={`c${i}`} x={PAD} y={H - 4} fill="#c0392b" fontSize={10}>
              {`əyri xətası: ${c.id}`}
            </text>
          )
        }
        const d = s.points
          .map((p, j) => `${j === 0 ? 'M' : 'L'}${sx(p[0]).toFixed(2)},${sy(p[1]).toFixed(2)}`)
          .join(' ')
        return (
          <g key={`c${i}`}>
            <path
              d={d}
              fill="none"
              stroke={COLOR_HEX[c.color]}
              strokeWidth={2}
              markerEnd={c.ends === 'arrow' ? 'url(#arrow)' : undefined}
            />
            {c.label && (
              <FigLabel
                x={sx(c.label.at[0])}
                y={sy(c.label.at[1])}
                tex={c.label.tex}
                anchor={c.label.anchor ?? 'left'}
                color={c.color}
                size={13}
              />
            )}
          </g>
        )
      })}

      {/* marked points */}
      {(panel.points ?? []).map((p, i) => (
        <g key={`p${i}`}>
          <circle
            cx={sx(p.x)}
            cy={sy(p.y)}
            r={3.4}
            fill={p.style === 'open' ? 'white' : COLOR_HEX[p.color ?? 'ink']}
            stroke={COLOR_HEX[p.color ?? 'ink']}
            strokeWidth={1.4}
          />
          {p.label && <FigLabel x={sx(p.x) + 5} y={sy(p.y) - 5} tex={p.label} anchor="left" size={12} />}
        </g>
      ))}
    </svg>
  )
}

export function FunctionGraphView({ fig }: { fig: FunctionGraphFig }) {
  return (
    <div className="flex flex-wrap items-start gap-4">
      {fig.panels.map((p, i) => (
        <Panel key={i} panel={p} />
      ))}
    </div>
  )
}

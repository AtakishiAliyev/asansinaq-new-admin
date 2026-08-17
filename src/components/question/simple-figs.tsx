import {
  COLOR_HEX,
  type DivisionScheme,
  type NumberLineFig,
  type TableFig,
  type VerticalArithmetic,
} from '@/core/figures/figspec'
import { FigLabel } from './fig-label'
import { Tex } from './tex'

// Turkish long-division scheme:
//        A │ B
//     − ───│─────
//        5 │  4
// Dividend top-left, tall vertical bar, divisor top-right with a rule under it,
// quotient below the rule; subtraction step(s) with a minus + underline under
// the dividend, remainder at the bottom. This must NOT read as a fraction.
export function DivisionSchemeView({ fig }: { fig: DivisionScheme }) {
  const steps = fig.steps ?? []
  const hasSub = steps.length > 0 || fig.remainderTex !== undefined
  return (
    <div className="inline-flex items-stretch text-base leading-[1.7]">
      <div className="min-w-14 px-3 text-center">
        <div>
          <Tex tex={fig.dividendTex} />
        </div>
        {hasSub &&
          (steps.length ? (
            steps.map((s, i) => (
              <div key={i} className="relative px-1" style={{ borderBottom: `1.5px solid ${COLOR_HEX.ink}` }}>
                <span className="absolute -left-3">{s.op ?? '−'}</span>
                <Tex tex={s.tex} />
              </div>
            ))
          ) : (
            <div className="relative h-[1.2em]" style={{ borderBottom: `1.5px solid ${COLOR_HEX.ink}` }}>
              <span className="absolute top-0 -left-3">−</span>
            </div>
          ))}
        {fig.remainderTex !== undefined && (
          <div>
            <Tex tex={fig.remainderTex} />
          </div>
        )}
      </div>
      <div className="min-w-12 px-3 text-center" style={{ borderLeft: `1.7px solid ${COLOR_HEX.ink}` }}>
        <div className="px-1" style={{ borderBottom: `1.5px solid ${COLOR_HEX.ink}` }}>
          <Tex tex={fig.divisorTex} />
        </div>
        <div className="px-1">
          <Tex tex={fig.quotientTex} />
        </div>
      </div>
    </div>
  )
}

// Normalize masked digits: "...." → bullets (Tex then renders them as \bullet).
function maskDots(s: string): string {
  return s.replace(/\.{2,}/g, (m) => '•'.repeat(m.length))
}

// Rows render through KaTeX so both plain digits ("9762"), symbolic digits
// ("a13b2"), letter blocks ("\text{KLM}") and masked bullets ("••••") all
// display correctly. Right-justified for column stacking.
export function VerticalArithmeticView({ fig }: { fig: VerticalArithmetic }) {
  const hl = new Set(fig.hlineAfter ?? [])
  const row = (tex: string, op?: string, indent = 0, key?: string | number, topRule = false) => (
    <div
      key={key}
      className="flex items-baseline justify-end gap-2"
      style={{
        paddingRight: indent * 12,
        borderTop: topRule ? `1.5px solid ${COLOR_HEX.ink}` : undefined,
      }}
    >
      {op && <span>{op}</span>}
      <Tex tex={maskDots(tex)} />
    </div>
  )
  return (
    <div className="inline-block min-w-[90px] text-[17px] leading-[1.7]">
      {fig.rows.map((r, i) => (
        <div key={i} style={{ borderBottom: hl.has(i) ? `1.5px solid ${COLOR_HEX.ink}` : undefined }}>
          {row(r.tex, r.op, r.indent ?? 0)}
        </div>
      ))}
      {fig.resultTex !== undefined && row(fig.resultTex, undefined, 0, 'res', !hl.has(fig.rows.length - 1))}
    </div>
  )
}

export function TableFigView({ fig }: { fig: TableFig }) {
  const hr = fig.headerRows ?? 0
  const hc = fig.headerCols ?? 0
  return (
    <table className="border-collapse text-[15px]">
      <tbody>
        {fig.cells.map((row, r) => (
          <tr key={r}>
            {row.map((cell, c) => {
              const isHeader = r < hr || c < hc
              return (
                <td
                  key={c}
                  className={`px-2.5 py-1 text-center ${isHeader ? 'font-semibold' : 'font-normal'}`}
                  style={{
                    border: `1px solid ${COLOR_HEX.ink}`,
                    background: isHeader ? '#EAF0FB' : undefined,
                  }}
                >
                  {cell ? <Tex tex={cell} /> : ''}
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function NumberLineView({ fig }: { fig: NumberLineFig }) {
  const W = 340
  const H = 64
  const PAD = 20
  const sx = (v: number) => PAD + ((v - fig.min) / (fig.max - fig.min)) * (W - 2 * PAD)
  const y = 30
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img">
      <defs>
        <marker id="nlarrow" markerWidth={8} markerHeight={8} refX={6} refY={3} orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill={COLOR_HEX.ink} />
        </marker>
      </defs>
      <line
        x1={PAD - 6}
        y1={y}
        x2={W - PAD + 6}
        y2={y}
        stroke={COLOR_HEX.ink}
        strokeWidth={1.2}
        markerEnd="url(#nlarrow)"
        markerStart="url(#nlarrow)"
      />
      {(fig.intervals ?? []).map((iv, i) => (
        <line
          key={`iv${i}`}
          x1={sx(iv.from)}
          y1={y}
          x2={sx(iv.to)}
          y2={y}
          stroke={COLOR_HEX[iv.color ?? 'primary']}
          strokeWidth={3}
        />
      ))}
      {fig.ticks.map((t, i) => (
        <g key={`t${i}`}>
          <line x1={sx(t.at)} y1={y - 4} x2={sx(t.at)} y2={y + 4} stroke={COLOR_HEX.ink} />
          <FigLabel x={sx(t.at)} y={y + 10} tex={t.tex} anchor="below" size={12} />
        </g>
      ))}
      {(fig.points ?? []).map((p, i) => (
        <circle
          key={`p${i}`}
          cx={sx(p.at)}
          cy={y}
          r={4}
          fill={p.style === 'open' ? 'white' : COLOR_HEX.ink}
          stroke={COLOR_HEX.ink}
          strokeWidth={1.4}
        />
      ))}
    </svg>
  )
}

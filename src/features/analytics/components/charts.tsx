import { useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

// The analytics chart kit: four forms, hand-drawn as SVG so every colour is
// a class the theme owns and one chart does not earn a dependency.
//
// Rules the kit keeps for every chart (DESIGN: the dataviz method):
// - ONE hue for magnitude (sky), the status trio for verdicts (emerald /
//   red / zinc — a pair that survives red-green colour blindness, ΔE 8.6),
//   never a rainbow; text never wears the data colour.
// - Thin marks (≤ 20px), a 4px rounded data-end, square at the baseline;
//   2px of surface between touching fills; hairline solid gridlines.
// - Labels are selective: the tip of a bar, the cap of the tallest
//   column; the tooltip and the table under the chart carry the rest.
// - Every mark is a hit target bigger than itself, with a tooltip; the
//   hovered mark lifts and the others step back.

const MAGNITUDE = 'fill-sky-600'
const OK = 'fill-emerald-600'
const BAD = 'fill-red-600'
const BLANK = 'fill-zinc-400/70'

type Tip = { x: number; y: number; body: ReactNode } | null

function useTip() {
  const [tip, setTip] = useState<Tip>(null)
  const box = useRef<HTMLDivElement>(null)
  const show = (e: React.MouseEvent, body: ReactNode) => {
    const r = box.current?.getBoundingClientRect()
    if (!r) return
    setTip({ x: e.clientX - r.left, y: e.clientY - r.top, body })
  }
  return { tip, setTip, show, box }
}

function Tooltip({ tip, width }: { tip: Tip; width: number }) {
  if (!tip) return null
  return (
    <div
      role="tooltip"
      className="bg-popover text-popover-foreground pointer-events-none absolute z-10 min-w-32 rounded-md border px-2.5 py-1.5 text-xs shadow-md"
      style={{
        left: Math.min(tip.x + 12, Math.max(0, width - 200)),
        top: tip.y - 10,
      }}
    >
      {tip.body}
    </div>
  )
}

/** A tooltip row: the value strong, the label quiet — the legend inverted. */
export function TipRow({
  value,
  label,
  swatch,
}: {
  value: string
  label: string
  swatch?: string
}) {
  return (
    <div className="flex items-baseline gap-2">
      {swatch ? (
        <span
          aria-hidden
          className={cn('inline-block h-0.5 w-3 self-center rounded', swatch)}
        />
      ) : null}
      <span className="font-semibold tabular-nums">{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </div>
  )
}

/** A clean tick step (1, 2, 5 × 10^k) aimed at about five ticks. */
function niceStep(max: number, target = 5): number {
  const raw = max / target
  const pow = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-9)))
  const m = raw / pow
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * pow
}

/** A bar whose data end is rounded and whose baseline end is square. */
function capped(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  dir: 'right' | 'up',
): string {
  const rr = Math.min(r, w / 2, h / 2)
  if (dir === 'right') {
    return `M${x},${y} H${x + w - rr} A${rr},${rr} 0 0 1 ${x + w},${y + rr} V${y + h - rr} A${rr},${rr} 0 0 1 ${x + w - rr},${y + h} H${x} Z`
  }
  return `M${x},${y + h} V${y + rr} A${rr},${rr} 0 0 1 ${x + rr},${y} H${x + w - rr} A${rr},${rr} 0 0 1 ${x + w},${y + rr} V${y + h} Z`
}

// ── horizontal bars: magnitude by category ──────────────────────────────────
export type BarRow = {
  key: string | number
  label: string
  value: number
  hint?: string
  tone?: 'ok' | 'bad'
}

export function BarList({
  rows,
  max,
  format = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1)),
  unit = '',
  labelWidth = 180,
  emptyText = 'Məlumat yoxdur',
  ariaLabel,
}: {
  rows: BarRow[]
  /** A fixed scale (100 for a percentage); otherwise the largest value. */
  max?: number
  format?: (v: number) => string
  unit?: string
  labelWidth?: number
  emptyText?: string
  ariaLabel: string
}) {
  const { tip, setTip, show, box } = useTip()
  const [hoverKey, setHoverKey] = useState<BarRow['key'] | null>(null)
  if (!rows.length)
    return <p className="text-muted-foreground text-sm">{emptyText}</p>
  const ROW = 28
  const BAR = 14
  const TOP = 4
  const BOTTOM = 22
  const RIGHT = 56
  const width = 640
  const plotW = width - labelWidth - RIGHT
  const top = Math.max(1, max ?? Math.max(...rows.map((r) => r.value)))
  const step = niceStep(top)
  const axisMax = max ?? Math.ceil(top / step) * step
  const ticks = Array.from(
    { length: Math.floor(axisMax / step) + 1 },
    (_, i) => i * step,
  )
  const height = TOP + rows.length * ROW + BOTTOM
  const x = (v: number) => labelWidth + (v / axisMax) * plotW

  return (
    <div ref={box} className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        role="img"
        aria-label={ariaLabel}
        onMouseLeave={() => {
          setTip(null)
          setHoverKey(null)
        }}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line
              x1={x(v)}
              x2={x(v)}
              y1={TOP}
              y2={TOP + rows.length * ROW}
              className="stroke-border"
              strokeWidth={1}
            />
            <text
              x={x(v)}
              y={height - 6}
              textAnchor="middle"
              className="fill-muted-foreground text-[10px] tabular-nums"
            >
              {format(v)}
              {unit}
            </text>
          </g>
        ))}
        {rows.map((r, i) => {
          const y = TOP + i * ROW + (ROW - BAR) / 2
          const w = Math.max(0, (Math.min(r.value, axisMax) / axisMax) * plotW)
          const dim = hoverKey !== null && hoverKey !== r.key
          return (
            <g
              key={r.key}
              opacity={dim ? 0.45 : 1}
              onMouseMove={(e) => {
                setHoverKey(r.key)
                show(
                  e,
                  <>
                    <div className="font-medium">{r.label}</div>
                    <TipRow
                      value={`${format(r.value)}${unit}`}
                      label={r.hint ?? ''}
                    />
                  </>,
                )
              }}
            >
              <rect
                x={0}
                y={TOP + i * ROW}
                width={width}
                height={ROW}
                fill="transparent"
              />
              <text
                x={labelWidth - 10}
                y={y + BAR / 2 + 3.5}
                textAnchor="end"
                className="fill-foreground text-[11px]"
              >
                {r.label.length > 28 ? `${r.label.slice(0, 27)}…` : r.label}
              </text>
              {w > 0 ? (
                <path
                  d={capped(x(0), y, w, BAR, 4, 'right')}
                  className={
                    r.tone === 'bad' ? BAD : r.tone === 'ok' ? OK : MAGNITUDE
                  }
                />
              ) : null}
              <text
                x={x(0) + w + 6}
                y={y + BAR / 2 + 3.5}
                className="fill-muted-foreground text-[10px] tabular-nums"
              >
                {format(r.value)}
                {unit}
              </text>
            </g>
          )
        })}
      </svg>
      <Tooltip tip={tip} width={width} />
    </div>
  )
}

// ── columns: magnitude along an ordered axis (bins, questions, days) ───────
export type ColumnPoint = {
  key: string | number
  label: string
  value: number
  tone?: 'ok' | 'bad'
  tip?: ReactNode
}

export function Columns({
  points,
  max,
  format = (v) => String(v),
  unit = '',
  height = 160,
  labelEvery = 1,
  ariaLabel,
}: {
  points: ColumnPoint[]
  max?: number
  format?: (v: number) => string
  unit?: string
  height?: number
  /** Show every n-th x label; the rest live in the tooltip. */
  labelEvery?: number
  ariaLabel: string
}) {
  const { tip, setTip, show, box } = useTip()
  const [hoverKey, setHoverKey] = useState<ColumnPoint['key'] | null>(null)
  if (!points.length)
    return <p className="text-muted-foreground text-sm">Məlumat yoxdur</p>
  const width = 640
  const LEFT = 36
  const RIGHT = 8
  const TOP = 8
  const BOTTOM = 22
  const plotW = width - LEFT - RIGHT
  const plotH = height - TOP - BOTTOM
  const top = Math.max(1, max ?? Math.max(...points.map((p) => p.value)))
  const step = niceStep(top, 4)
  const axisMax = max ?? Math.ceil(top / step) * step
  const ticks = Array.from(
    { length: Math.floor(axisMax / step) + 1 },
    (_, i) => i * step,
  )
  const slot = plotW / points.length
  const barW = Math.min(20, Math.max(3, slot - 3))
  const x = (i: number) => LEFT + i * slot + (slot - barW) / 2
  const y = (v: number) =>
    TOP + plotH - (Math.min(v, axisMax) / axisMax) * plotH
  const peak = points.reduce((m, p) => (p.value > m.value ? p : m), points[0]!)

  return (
    <div ref={box} className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        role="img"
        aria-label={ariaLabel}
        onMouseLeave={() => {
          setTip(null)
          setHoverKey(null)
        }}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line
              x1={LEFT}
              x2={width - RIGHT}
              y1={y(v)}
              y2={y(v)}
              className="stroke-border"
              strokeWidth={1}
            />
            <text
              x={LEFT - 6}
              y={y(v) + 3.5}
              textAnchor="end"
              className="fill-muted-foreground text-[10px] tabular-nums"
            >
              {format(v)}
              {unit}
            </text>
          </g>
        ))}
        {points.map((p, i) => {
          const h = TOP + plotH - y(p.value)
          const dim = hoverKey !== null && hoverKey !== p.key
          return (
            <g
              key={p.key}
              opacity={dim ? 0.45 : 1}
              onMouseMove={(e) => {
                setHoverKey(p.key)
                show(
                  e,
                  p.tip ?? (
                    <>
                      <div className="font-medium">{p.label}</div>
                      <TipRow value={`${format(p.value)}${unit}`} label="" />
                    </>
                  ),
                )
              }}
            >
              <rect
                x={LEFT + i * slot}
                y={TOP}
                width={slot}
                height={plotH + BOTTOM}
                fill="transparent"
              />
              {h > 0 ? (
                <path
                  d={capped(x(i), y(p.value), barW, h, 4, 'up')}
                  className={
                    p.tone === 'bad' ? BAD : p.tone === 'ok' ? OK : MAGNITUDE
                  }
                />
              ) : (
                <rect
                  x={x(i)}
                  y={TOP + plotH - 1}
                  width={barW}
                  height={1}
                  className="fill-border"
                />
              )}
              {p.key === peak.key && peak.value > 0 && hoverKey === null ? (
                <text
                  x={x(i) + barW / 2}
                  y={y(p.value) - 4}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[10px] tabular-nums"
                >
                  {format(p.value)}
                  {unit}
                </text>
              ) : null}
              {i % labelEvery === 0 ? (
                <text
                  x={x(i) + barW / 2}
                  y={height - 6}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[10px] tabular-nums"
                >
                  {p.label}
                </text>
              ) : null}
            </g>
          )
        })}
      </svg>
      <Tooltip tip={tip} width={width} />
    </div>
  )
}

// ── stacked bars: correct / wrong / blank as part-to-whole ─────────────────
export type ShareRow = {
  key: string | number
  label: string
  correct: number
  wrong: number
  blank: number
  hint?: string
}

export function ShareBars({
  rows,
  ariaLabel,
  labelWidth = 180,
}: {
  rows: ShareRow[]
  ariaLabel: string
  labelWidth?: number
}) {
  const { tip, setTip, show, box } = useTip()
  const [hoverKey, setHoverKey] = useState<ShareRow['key'] | null>(null)
  if (!rows.length)
    return <p className="text-muted-foreground text-sm">Məlumat yoxdur</p>
  const ROW = 26
  const BAR = 12
  const TOP = 4
  const BOTTOM = 22
  const RIGHT = 12
  const GAP = 2
  const width = 640
  const plotW = width - labelWidth - RIGHT
  const height = TOP + rows.length * ROW + BOTTOM
  const x = (v: number) => labelWidth + (v / 100) * plotW

  return (
    <div ref={box} className="relative">
      <div
        className="text-muted-foreground mb-1 flex justify-end gap-4 text-xs"
        aria-label="Şərti işarələr"
      >
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block size-2.5 rounded-[2px] bg-emerald-600"
          />
          doğru
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block size-2.5 rounded-[2px] bg-red-600"
          />
          səhv
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block size-2.5 rounded-[2px] bg-zinc-400/70"
          />
          boş
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        role="img"
        aria-label={ariaLabel}
        onMouseLeave={() => {
          setTip(null)
          setHoverKey(null)
        }}
      >
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line
              x1={x(v)}
              x2={x(v)}
              y1={TOP}
              y2={TOP + rows.length * ROW}
              className="stroke-border"
              strokeWidth={1}
            />
            <text
              x={x(v)}
              y={height - 6}
              textAnchor="middle"
              className="fill-muted-foreground text-[10px] tabular-nums"
            >
              {v}%
            </text>
          </g>
        ))}
        {rows.map((r, i) => {
          const y = TOP + i * ROW + (ROW - BAR) / 2
          const parts: [number, string][] = [
            [r.correct, OK],
            [r.wrong, BAD],
            [r.blank, BLANK],
          ]
          let cursor = x(0)
          const dim = hoverKey !== null && hoverKey !== r.key
          return (
            <g
              key={r.key}
              opacity={dim ? 0.45 : 1}
              onMouseMove={(e) => {
                setHoverKey(r.key)
                show(
                  e,
                  <>
                    <div className="font-medium">{r.label}</div>
                    <TipRow
                      value={`${Math.round(r.correct)}%`}
                      label="doğru"
                      swatch="bg-emerald-600"
                    />
                    <TipRow
                      value={`${Math.round(r.wrong)}%`}
                      label="səhv"
                      swatch="bg-red-600"
                    />
                    <TipRow
                      value={`${Math.round(r.blank)}%`}
                      label="boş"
                      swatch="bg-zinc-400"
                    />
                    {r.hint ? (
                      <div className="text-muted-foreground mt-0.5">
                        {r.hint}
                      </div>
                    ) : null}
                  </>,
                )
              }}
            >
              <rect
                x={0}
                y={TOP + i * ROW}
                width={width}
                height={ROW}
                fill="transparent"
              />
              <text
                x={labelWidth - 10}
                y={y + BAR / 2 + 3.5}
                textAnchor="end"
                className="fill-foreground text-[11px]"
              >
                {r.label.length > 28 ? `${r.label.slice(0, 27)}…` : r.label}
              </text>
              {parts.map(([v, cls], j) => {
                const w = (v / 100) * plotW
                if (w <= 0) return null
                const gapBefore = cursor > x(0) ? GAP : 0
                const el = (
                  <rect
                    key={j}
                    x={cursor + gapBefore}
                    y={y}
                    width={Math.max(0, w - gapBefore)}
                    height={BAR}
                    rx={
                      j === 2 ||
                      (j === 1 && r.blank === 0) ||
                      (j === 0 && r.wrong === 0 && r.blank === 0)
                        ? 3
                        : 0
                    }
                    className={cls}
                  />
                )
                cursor += w
                return el
              })}
            </g>
          )
        })}
      </svg>
      <Tooltip tip={tip} width={width} />
    </div>
  )
}

// ── trend: one series over ordered sittings ─────────────────────────────────
export type TrendPoint = {
  key: string | number
  label: string
  value: number
  hint?: string
}

export function TrendLine({
  points,
  max = 100,
  unit = '%',
  height = 150,
  ariaLabel,
}: {
  points: TrendPoint[]
  max?: number
  unit?: string
  height?: number
  ariaLabel: string
}) {
  const { tip, setTip, show, box } = useTip()
  const [hoverI, setHoverI] = useState<number | null>(null)
  if (points.length < 2)
    return (
      <p className="text-muted-foreground text-sm">
        Trend üçün ən azı iki cəhd lazımdır.
      </p>
    )
  const width = 640
  const LEFT = 36
  const RIGHT = 16
  const TOP = 12
  const BOTTOM = 22
  const plotW = width - LEFT - RIGHT
  const plotH = height - TOP - BOTTOM
  const step = niceStep(max, 4)
  const ticks = Array.from(
    { length: Math.floor(max / step) + 1 },
    (_, i) => i * step,
  )
  const x = (i: number) => LEFT + (i / (points.length - 1)) * plotW
  const y = (v: number) => TOP + plotH - (Math.min(v, max) / max) * plotH
  const d = points
    .map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.value)}`)
    .join(' ')
  const last = points[points.length - 1]!

  return (
    <div ref={box} className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        role="img"
        aria-label={ariaLabel}
        onMouseLeave={() => {
          setTip(null)
          setHoverI(null)
        }}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
          const px = ((e.clientX - r.left) / r.width) * width
          const i = Math.max(
            0,
            Math.min(
              points.length - 1,
              Math.round(((px - LEFT) / plotW) * (points.length - 1)),
            ),
          )
          const p = points[i]!
          setHoverI(i)
          show(
            e,
            <>
              <div className="font-medium">{p.label}</div>
              <TipRow
                value={`${Math.round(p.value)}${unit}`}
                label={p.hint ?? ''}
                swatch="bg-sky-600"
              />
            </>,
          )
        }}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line
              x1={LEFT}
              x2={width - RIGHT}
              y1={y(v)}
              y2={y(v)}
              className="stroke-border"
              strokeWidth={1}
            />
            <text
              x={LEFT - 6}
              y={y(v) + 3.5}
              textAnchor="end"
              className="fill-muted-foreground text-[10px] tabular-nums"
            >
              {v}
              {unit}
            </text>
          </g>
        ))}
        {hoverI !== null ? (
          <line
            x1={x(hoverI)}
            x2={x(hoverI)}
            y1={TOP}
            y2={TOP + plotH}
            className="stroke-muted-foreground/50"
            strokeWidth={1}
          />
        ) : null}
        <path
          d={`${d} L${x(points.length - 1)},${TOP + plotH} L${LEFT},${TOP + plotH} Z`}
          className="fill-sky-600/10"
        />
        <path
          d={d}
          fill="none"
          className="stroke-sky-600"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {points.map((p, i) => (
          <g key={p.key}>
            <circle
              cx={x(i)}
              cy={y(p.value)}
              r={hoverI === i ? 6 : 4}
              className="fill-sky-600 stroke-background"
              strokeWidth={2}
            />
            {i % Math.max(1, Math.ceil(points.length / 8)) === 0 ||
            i === points.length - 1 ? (
              <text
                x={x(i)}
                y={height - 6}
                textAnchor="middle"
                className="fill-muted-foreground text-[10px] tabular-nums"
              >
                {p.label}
              </text>
            ) : null}
          </g>
        ))}
        {hoverI === null ? (
          <text
            x={x(points.length - 1)}
            y={y(last.value) - 9}
            textAnchor="middle"
            className="fill-muted-foreground text-[10px] tabular-nums"
          >
            {Math.round(last.value)}
            {unit}
          </text>
        ) : null}
      </svg>
      <Tooltip tip={tip} width={width} />
    </div>
  )
}

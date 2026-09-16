import { useState } from 'react'
import type { TopicRow } from '@/features/dashboard/components/topic-map'

// The filled topics as a stacked horizontal bar chart: approved against still
// in the pipeline, one axis, gridlines, a hover tooltip. Drawn as SVG rather
// than through a chart library, because one chart does not earn a dependency
// and every colour here has to be a theme token so it reads in both modes.
//
// Only topics WITH questions are drawn — a zero-length bar is not a mark, and
// the map view is where the empty topics are shown. The count of them is
// written under the chart so the reader is not left thinking the subject has
// eight topics.

const ROW = 26
const LABEL_W = 196
const RIGHT_PAD = 56
const TOP = 8
const BOTTOM = 26
const GAP = 2

/**
 * A bar segment whose RIGHT end is rounded and whose left is square.
 *
 * `<rect rx>` rounds all four corners. A stacked bar has one data end — the
 * outermost segment's right — and every other edge is either the baseline or
 * a join with the neighbouring segment, both of which must stay square or the
 * bar reads as two pills laid end to end.
 */
function rightCapped(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h / 2)
  return `M${x},${y} H${x + w - rr} A${rr},${rr} 0 0 1 ${x + w},${y + rr} V${y + h - rr} A${rr},${rr} 0 0 1 ${x + w - rr},${y + h} H${x} Z`
}

/** A round tick step for the x axis: 1, 2, 5 × 10^k, aimed at ~5 ticks. */
function niceStep(max: number): number {
  const raw = max / 5
  const pow = 10 ** Math.floor(Math.log10(Math.max(raw, 1)))
  const m = raw / pow
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * pow
}

export function TopicBarChart({ topics, emptyCount }: { topics: TopicRow[]; emptyCount: number }) {
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null)
  const rows = topics.filter((t) => (t.totals?.total ?? 0) > 0)
  if (!rows.length) return null

  const max = Math.max(...rows.map((t) => t.totals!.total))
  const step = niceStep(max)
  const axisMax = Math.ceil(max / step) * step
  const ticks = Array.from({ length: axisMax / step + 1 }, (_, i) => i * step)

  const width = 760
  const plotW = width - LABEL_W - RIGHT_PAD
  const height = TOP + rows.length * ROW + BOTTOM
  const x = (v: number) => LABEL_W + (v / axisMax) * plotW
  const hovered = hover ? rows[hover.i] : null

  return (
    <div className="relative">
      <div className="text-muted-foreground mb-2 flex items-center justify-end gap-4 text-xs" aria-label="Şərti işarələr">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block size-2.5 rounded-[2px] bg-emerald-600 dark:bg-emerald-500" />
          təsdiqlənmiş
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="bg-muted-foreground/55 inline-block size-2.5 rounded-[2px]" />
          hazırlanır
        </span>
      </div>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          style={{ minWidth: 560 }}
          role="img"
          aria-label={`Mövzu üzrə sual sayı: ${rows.map((t) => `${t.name} ${t.totals!.total}`).join(', ')}`}
          onMouseLeave={() => setHover(null)}
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
                y={height - 8}
                textAnchor="middle"
                className="fill-muted-foreground text-[11px] tabular-nums"
              >
                {v}
              </text>
            </g>
          ))}
          {rows.map((t, i) => {
            const total = t.totals!.total
            const approved = t.totals!.approved
            const pending = total - approved
            const y = TOP + i * ROW + 5
            const h = ROW - 10
            const wA = (approved / axisMax) * plotW
            const wP = (pending / axisMax) * plotW
            const dim = hover !== null && hover.i !== i
            return (
              <g
                key={t.id}
                opacity={dim ? 0.55 : 1}
                onMouseMove={(e) => {
                  const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect()
                  setHover({ i, x: e.clientX - box.left, y: e.clientY - box.top })
                }}
              >
                <rect x={0} y={TOP + i * ROW} width={width} height={ROW} fill="transparent" />
                <text
                  x={LABEL_W - 10}
                  y={y + h / 2 + 4}
                  textAnchor="end"
                  className="fill-foreground text-[12px]"
                >
                  {t.name.length > 30 ? `${t.name.slice(0, 29)}…` : t.name}
                </text>
                {approved > 0 ? (
                  pending > 0 ? (
                    <rect
                      x={x(0)}
                      y={y}
                      width={Math.max(0, wA - GAP / 2)}
                      height={h}
                      className="fill-emerald-600 dark:fill-emerald-500"
                    />
                  ) : (
                    <path d={rightCapped(x(0), y, wA, h, 4)} className="fill-emerald-600 dark:fill-emerald-500" />
                  )
                ) : null}
                {pending > 0 ? (
                  <path
                    d={rightCapped(
                      x(0) + wA + (approved > 0 ? GAP / 2 : 0),
                      y,
                      Math.max(0, wP - (approved > 0 ? GAP / 2 : 0)),
                      h,
                      4,
                    )}
                    className="fill-muted-foreground/55"
                  />
                ) : null}
                <text
                  x={x(total) + 8}
                  y={y + h / 2 + 4}
                  className="fill-muted-foreground text-[11px] tabular-nums"
                >
                  {total}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
      {hovered && hover ? (
        <div
          role="tooltip"
          className="bg-popover text-popover-foreground pointer-events-none absolute z-10 rounded-md border px-2.5 py-1.5 text-xs shadow-md"
          style={{ left: Math.min(hover.x + 12, width - 220), top: hover.y - 8 }}
        >
          <div className="font-medium">{hovered.name}</div>
          <div className="text-muted-foreground tabular-nums">
            {hovered.totals!.total} sual · {hovered.totals!.approved} təsdiqlənib ·{' '}
            {hovered.totals!.total - hovered.totals!.approved} hazırlanır · {hovered.totals!.books} kitab
          </div>
        </div>
      ) : null}
      {emptyCount > 0 ? (
        <p className="text-muted-foreground mt-2 text-xs">
          {emptyCount} mövzu boşdur — qrafikdə çəkilmir, xəritə görünüşündə görünür.
        </p>
      ) : null}
    </div>
  )
}

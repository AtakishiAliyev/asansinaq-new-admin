import { useCallback, useRef, useState } from 'react'
import type { GeometryFig } from '@/core/figures/figspec'
import { geometryFit, renderFigItem } from '@/core/figures/render'
import { cn } from '@/lib/utils'

// The figure, with handles on it.
//
// The drawing underneath is the REAL renderer's output, not a second drawing
// made for editing. An editor that drew its own approximation would let a
// reviewer position a point against one picture and ship another, and the two
// would only have to disagree slightly for the disagreement to reach the bank.
//
// The handles use `geometryFit`, the same fit the renderer uses, for the same
// reason. The renderer scales the point cloud and reserves a margin for labels,
// so "roughly the cloud bounds" puts every handle a few pixels off its point —
// worst at the edges, where the margin lives.

export interface CanvasSelection {
  kind: 'point' | 'line' | 'angle'
  /** Point id, or index into lines/angles. */
  ref: string | number
}

export type CanvasMode = 'select' | 'line' | 'angle' | 'add'

interface Props {
  fig: GeometryFig
  selection: CanvasSelection | null
  onSelect: (selection: CanvasSelection | null) => void
  onMovePoint: (id: string, x: number, y: number) => void
  /** Points already picked while building an edge or an angle. */
  pending: string[]
  onPickPoint: (id: string) => void
  mode: CanvasMode
  onAddPoint: (x: number, y: number) => void
}

export function GeometryCanvas({
  fig,
  selection,
  onSelect,
  onMovePoint,
  pending,
  onPickPoint,
  mode,
  onAddPoint,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<string | null>(null)

  const svg = renderFigItem(fig, { idPrefix: 'edit' })
  const fit = geometryFit(fig)

  /** Canvas units → a percentage of the host, which scales with the element. */
  const screenOf = useCallback(
    (x: number, y: number) => {
      const at = fit.to({ x, y })
      return {
        left: `${((at.x / (fit.width || 1)) * 100).toFixed(3)}%`,
        top: `${((at.y / (fit.height || 1)) * 100).toFixed(3)}%`,
      }
    },
    [fit],
  )

  /**
   * Screen → the figure's own plane.
   *
   * The inverse of the fit, recovered from where two known points landed rather
   * than by reimplementing the scale: the fit chooses its own margin and
   * centring, and a second copy of that arithmetic is a second thing to keep in
   * step. With fewer than two distinct points there is no scale to recover, so
   * the canvas units pass through.
   */
  const toPlane = useCallback(
    (clientX: number, clientY: number) => {
      const host = hostRef.current
      if (!host) return null
      const rect = host.getBoundingClientRect()
      if (!rect.width || !rect.height) return null

      const cx = ((clientX - rect.left) / rect.width) * (fit.width || 1)
      const cy = ((clientY - rect.top) / rect.height) * (fit.height || 1)

      const xs = fig.points.map((p) => p.x)
      const ys = fig.points.map((p) => p.y)
      const spanX = Math.max(...xs, 0) - Math.min(...xs, 0)
      const spanY = Math.max(...ys, 0) - Math.min(...ys, 0)
      const origin = fit.to({ x: 0, y: 0 })
      const unitX = spanX > 0 ? fit.to({ x: 1, y: 0 }).x - origin.x : 0
      const unitY = spanY > 0 ? fit.to({ x: 0, y: 1 }).y - origin.y : 0

      return {
        x: unitX !== 0 ? (cx - origin.x) / unitX : cx,
        y: unitY !== 0 ? (cy - origin.y) / unitY : cy,
      }
    },
    [fig.points, fit],
  )

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging) return
    const plane = toPlane(e.clientX, e.clientY)
    if (plane) onMovePoint(dragging, plane.x, plane.y)
  }

  const handleBackground = (e: React.MouseEvent) => {
    if (mode !== 'add') {
      onSelect(null)
      return
    }
    const plane = toPlane(e.clientX, e.clientY)
    if (plane) onAddPoint(plane.x, plane.y)
  }

  const picking = mode === 'line' || mode === 'angle'

  return (
    <div
      className={cn('relative rounded-md border bg-white', mode === 'add' && 'cursor-crosshair')}
      onPointerMove={handlePointerMove}
      onPointerUp={() => setDragging(null)}
      onPointerLeave={() => setDragging(null)}
    >
      {/* The real render, inert: every interaction lives on the overlay. */}
      <div
        ref={hostRef}
        className="pointer-events-none [&_svg]:h-auto [&_svg]:w-full"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <button
        type="button"
        aria-label={mode === 'add' ? 'Boş yerə klikləyib nöqtə əlavə et' : 'Seçimi ləğv et'}
        className="absolute inset-0 size-full"
        onClick={handleBackground}
      />

      {fig.points.map((point) => {
        const isSelected = selection?.kind === 'point' && selection.ref === point.id
        const order = pending.indexOf(point.id)
        return (
          <button
            key={point.id}
            type="button"
            title={point.label ? `${point.id} (${point.label})` : point.id}
            aria-label={`Nöqtə ${point.id}`}
            style={screenOf(point.x, point.y)}
            className={cn(
              'absolute flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center',
              'rounded-full border-2 text-[9px] font-semibold transition hover:scale-125',
              isSelected
                ? 'border-primary bg-primary/30'
                : order >= 0
                  ? 'border-secondary bg-secondary text-secondary-foreground'
                  : 'border-foreground/50 bg-background/70',
              !picking && 'cursor-grab active:cursor-grabbing',
            )}
            onPointerDown={(e) => {
              // While picking, a press must not start a drag — the reviewer is
              // choosing endpoints, not moving them.
              if (picking) return
              e.preventDefault()
              setDragging(point.id)
              onSelect({ kind: 'point', ref: point.id })
            }}
            onClick={(e) => {
              e.stopPropagation()
              if (picking) onPickPoint(point.id)
              else onSelect({ kind: 'point', ref: point.id })
            }}
          >
            {order >= 0 ? order + 1 : ''}
          </button>
        )
      })}
    </div>
  )
}

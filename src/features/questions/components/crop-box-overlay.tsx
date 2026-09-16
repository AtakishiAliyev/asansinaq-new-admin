import { useRef } from 'react'
import type { CropBox } from '@/core/segment/manual-band'
import { cn } from '@/lib/utils'

// A rectangle the operator can drag and resize over a rendered page.
//
// Coordinates in and out are PDF POINTS — the segmenter's frame — and the
// component scales them to screen pixels itself, so the caller never has to
// know how large the page was drawn. Pointer capture is what makes a drag
// survive the cursor leaving the handle; without it a fast drag lets go the
// moment the pointer outruns the 12px hit target.
//
// Keyboard: arrows move the box a point at a time, Shift+arrows grow or
// shrink its right and bottom edges. That is the whole vocabulary — a box has
// four numbers, and a person correcting one usually needs to nudge one edge.

/** Smallest box that can still hold a question. */
const MIN_PT = 20

type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'move'

const HANDLES: { edge: Edge; className: string }[] = [
  { edge: 'nw', className: 'top-0 left-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize' },
  { edge: 'n', className: 'top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize' },
  { edge: 'ne', className: 'top-0 right-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize' },
  { edge: 'e', className: 'top-1/2 right-0 translate-x-1/2 -translate-y-1/2 cursor-ew-resize' },
  { edge: 'se', className: 'right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize' },
  { edge: 's', className: 'bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 cursor-ns-resize' },
  { edge: 'sw', className: 'bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize' },
  { edge: 'w', className: 'top-1/2 left-0 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize' },
]

function clampBox(b: CropBox, pageW: number, pageH: number): CropBox {
  const w = Math.min(Math.max(b.w, MIN_PT), pageW)
  const h = Math.min(Math.max(b.h, MIN_PT), pageH)
  const x = Math.min(Math.max(b.x, 0), pageW - w)
  const y = Math.min(Math.max(b.y, 0), pageH - h)
  return { x, y, w, h }
}

export function CropBoxOverlay({
  box,
  pageWidthPt,
  pageHeightPt,
  scale,
  onChange,
}: {
  box: CropBox
  /** The page's size in PDF points; the box is kept inside it. */
  pageWidthPt: number
  pageHeightPt: number
  /** Screen pixels per PDF point, as the page was rendered. */
  scale: number
  onChange: (box: CropBox) => void
}) {
  const drag = useRef<{ edge: Edge; startX: number; startY: number; start: CropBox } | null>(null)

  function begin(edge: Edge) {
    return (e: React.PointerEvent<HTMLElement>) => {
      e.preventDefault()
      e.stopPropagation()
      e.currentTarget.setPointerCapture(e.pointerId)
      drag.current = { edge, startX: e.clientX, startY: e.clientY, start: box }
    }
  }

  function move(e: React.PointerEvent<HTMLElement>) {
    const d = drag.current
    if (!d) return
    const dx = (e.clientX - d.startX) / scale
    const dy = (e.clientY - d.startY) / scale
    const s = d.start
    let next: CropBox
    switch (d.edge) {
      case 'move':
        next = { ...s, x: s.x + dx, y: s.y + dy }
        break
      case 'e':
        next = { ...s, w: s.w + dx }
        break
      case 'w':
        next = { ...s, x: s.x + dx, w: s.w - dx }
        break
      case 's':
        next = { ...s, h: s.h + dy }
        break
      case 'n':
        next = { ...s, y: s.y + dy, h: s.h - dy }
        break
      case 'se':
        next = { ...s, w: s.w + dx, h: s.h + dy }
        break
      case 'sw':
        next = { ...s, x: s.x + dx, w: s.w - dx, h: s.h + dy }
        break
      case 'ne':
        next = { ...s, y: s.y + dy, w: s.w + dx, h: s.h - dy }
        break
      case 'nw':
        next = { ...s, x: s.x + dx, y: s.y + dy, w: s.w - dx, h: s.h - dy }
        break
    }
    // A left/top edge dragged past the opposite one would flip the box;
    // holding the far edge still keeps the rectangle a rectangle.
    if (next.w < MIN_PT && (d.edge.includes('w') || d.edge === 'w')) next = { ...next, x: s.x + s.w - MIN_PT, w: MIN_PT }
    if (next.h < MIN_PT && d.edge.includes('n')) next = { ...next, y: s.y + s.h - MIN_PT, h: MIN_PT }
    onChange(clampBox(next, pageWidthPt, pageHeightPt))
  }

  function end(e: React.PointerEvent<HTMLElement>) {
    if (!drag.current) return
    drag.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const step = e.altKey ? 10 : 1
    const dx = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0
    const dy = e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0
    if (!dx && !dy) return
    e.preventDefault()
    e.stopPropagation()
    const next = e.shiftKey
      ? { ...box, w: box.w + dx, h: box.h + dy }
      : { ...box, x: box.x + dx, y: box.y + dy }
    onChange(clampBox(next, pageWidthPt, pageHeightPt))
  }

  const px = (v: number) => `${v * scale}px`

  return (
    <div
      role="group"
      aria-label="Krop qutusu — oxlarla sürüşdür, Shift ilə ölçüsünü dəyiş, Alt ilə on nöqtə"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={begin('move')}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      className={cn(
        'absolute cursor-move touch-none border-2 border-sky-500 bg-sky-500/10',
        'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
      )}
      style={{ left: px(box.x), top: px(box.y), width: px(box.w), height: px(box.h) }}
    >
      {HANDLES.map((h) => (
        <span
          key={h.edge}
          aria-hidden
          onPointerDown={begin(h.edge)}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          className={cn(
            'absolute size-3 rounded-sm border border-sky-700 bg-white shadow-sm',
            h.className,
          )}
        />
      ))}
    </div>
  )
}

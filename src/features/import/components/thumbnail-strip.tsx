import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { PDFDocumentProxy } from '@/features/import/lib/pdf'

const THUMB_WIDTH = 96

interface ThumbnailStripProps {
  doc: PDFDocumentProxy
  pageCount: number
  selected: Set<number>
  onOpen: (page: number) => void
}

// One lazy IntersectionObserver-driven thumb per page: a 300-page book must
// not render 300 canvases up front. Rendered thumbs are cached as data URLs.
function Thumb({
  doc,
  page,
  isSelected,
  isTabStop,
  onOpen,
  onFocus,
  buttonRef,
}: {
  doc: PDFDocumentProxy
  page: number
  isSelected: boolean
  isTabStop: boolean
  onOpen: () => void
  onFocus: () => void
  buttonRef: (el: HTMLButtonElement | null) => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el || src) return
    let cancelled = false
    const observer = new IntersectionObserver(async ([entry]) => {
      if (!entry?.isIntersecting) return
      observer.disconnect()
      try {
        const pdfPage = await doc.getPage(page)
        if (cancelled) return
        const viewport = pdfPage.getViewport({ scale: 1 })
        const scale = THUMB_WIDTH / viewport.width
        const scaled = pdfPage.getViewport({ scale })
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(scaled.width)
        canvas.height = Math.ceil(scaled.height)
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        await pdfPage.render({ canvas, viewport: scaled }).promise
        if (!cancelled) setSrc(canvas.toDataURL('image/jpeg'))
      } catch (error) {
        console.error('thumbnail render failed', page, error)
        if (!cancelled) setFailed(true)
      }
    })
    observer.observe(el)
    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [doc, page, src])

  return (
    <button
      ref={(el) => {
        ref.current = el
        buttonRef(el)
      }}
      type="button"
      tabIndex={isTabStop ? 0 : -1}
      onClick={onOpen}
      onFocus={onFocus}
      aria-label={`Səhifə ${page} — önbaxışda aç`}
      className={cn(
        'relative shrink-0 rounded-md border transition-colors',
        isSelected
          ? 'border-primary ring-primary/30 ring-2'
          : 'hover:border-muted-foreground/40',
      )}
    >
      {src ? (
        // eslint-disable-next-line jsx-a11y/alt-text -- decorative, button is labelled
        <img src={src} width={THUMB_WIDTH} className="rounded-md" />
      ) : (
        <div
          style={{ width: THUMB_WIDTH, height: Math.round(THUMB_WIDTH * 1.41) }}
          className={cn(
            'bg-muted rounded-md',
            failed
              ? 'text-muted-foreground flex items-center justify-center text-[10px]'
              : 'animate-pulse',
          )}
        >
          {failed ? 'alınmadı' : null}
        </div>
      )}
      <span
        className={cn(
          'absolute right-1 bottom-1 rounded px-1 font-mono text-[10px] tabular-nums',
          isSelected
            ? 'bg-primary text-primary-foreground'
            : 'bg-background/80',
        )}
      >
        {page}
      </span>
    </button>
  )
}

// Roving tabindex: the whole strip is ONE tab stop — a 300-page book must not
// cost 300 Tab presses to get past. Arrows/Home/End move within it.
export function ThumbnailStrip({
  doc,
  pageCount,
  selected,
  onOpen,
}: ThumbnailStripProps) {
  const [focusedPage, setFocusedPage] = useState(1)
  const buttonRefs = useRef(new Map<number, HTMLButtonElement>())

  // A new (shorter) document must not leave the roving stop out of range.
  useEffect(() => {
    setFocusedPage((current) => Math.min(current, pageCount))
  }, [pageCount])

  function moveFocus(page: number) {
    const next = Math.min(pageCount, Math.max(1, page))
    setFocusedPage(next)
    const el = buttonRefs.current.get(next)
    el?.focus()
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowRight') moveFocus(focusedPage + 1)
    else if (e.key === 'ArrowLeft') moveFocus(focusedPage - 1)
    else if (e.key === 'Home') moveFocus(1)
    else if (e.key === 'End') moveFocus(pageCount)
    else return
    e.preventDefault()
  }

  return (
    <div
      role="toolbar"
      aria-label="Səhifələr"
      className="flex gap-2 overflow-x-auto pb-2"
      onKeyDown={handleKeyDown}
    >
      {Array.from({ length: pageCount }, (_, i) => i + 1).map((page) => (
        <Thumb
          key={page}
          doc={doc}
          page={page}
          isSelected={selected.has(page)}
          isTabStop={page === focusedPage}
          onOpen={() => onOpen(page)}
          onFocus={() => setFocusedPage(page)}
          buttonRef={(el) => {
            if (el) buttonRefs.current.set(page, el)
            else buttonRefs.current.delete(page)
          }}
        />
      ))}
    </div>
  )
}

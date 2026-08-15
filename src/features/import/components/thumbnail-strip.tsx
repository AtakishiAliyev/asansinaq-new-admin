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
  onOpen,
}: {
  doc: PDFDocumentProxy
  page: number
  isSelected: boolean
  onOpen: () => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || src) return
    let cancelled = false
    const observer = new IntersectionObserver(async ([entry]) => {
      if (!entry.isIntersecting) return
      observer.disconnect()
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
    })
    observer.observe(el)
    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [doc, page, src])

  return (
    <button
      ref={ref}
      type="button"
      onClick={onOpen}
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
          className="bg-muted animate-pulse rounded-md"
        />
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

export function ThumbnailStrip({
  doc,
  pageCount,
  selected,
  onOpen,
}: ThumbnailStripProps) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-2" aria-label="Səhifələr">
      {Array.from({ length: pageCount }, (_, i) => i + 1).map((page) => (
        <Thumb
          key={page}
          doc={doc}
          page={page}
          isSelected={selected.has(page)}
          onOpen={() => onOpen(page)}
        />
      ))}
    </div>
  )
}

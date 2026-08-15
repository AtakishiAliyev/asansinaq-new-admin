import { useEffect, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import type { PDFDocumentProxy } from '@/features/import/lib/pdf'

const RENDER_WIDTH = 1100 // px; crisp enough to read question text
const CACHE_LIMIT = 20

interface PagePreviewDialogProps {
  doc: PDFDocumentProxy
  pageCount: number
  page: number | null
  isSelected: (page: number) => boolean
  onToggleSelected: (page: number) => void
  onNavigate: (page: number) => void
  onClose: () => void
}

// Full-page reading view: arrows (buttons or ← →) move through the book, the
// footer toggle adds/removes the page from the segmentation range without
// leaving the dialog. Rendered pages are cached so flipping back is instant.
export function PagePreviewDialog({
  doc,
  pageCount,
  page,
  isSelected,
  onToggleSelected,
  onNavigate,
  onClose,
}: PagePreviewDialogProps) {
  const cache = useRef(new Map<number, string>())
  const [src, setSrc] = useState<string | null>(null)

  // A different doc means a different cache; the component stays mounted.
  useEffect(() => {
    cache.current = new Map()
  }, [doc])

  useEffect(() => {
    if (page === null) return
    const cached = cache.current.get(page)
    if (cached) {
      setSrc(cached)
      return
    }
    setSrc(null)
    let cancelled = false
    void (async () => {
      const pdfPage = await doc.getPage(page)
      if (cancelled) return
      const base = pdfPage.getViewport({ scale: 1 })
      const viewport = pdfPage.getViewport({ scale: RENDER_WIDTH / base.width })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await pdfPage.render({ canvas, viewport }).promise
      if (cancelled) return
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
      if (cache.current.size >= CACHE_LIMIT) {
        const oldest = cache.current.keys().next().value
        if (oldest !== undefined) cache.current.delete(oldest)
      }
      cache.current.set(page, dataUrl)
      setSrc(dataUrl)
    })()
    return () => {
      cancelled = true
    }
  }, [doc, page])

  if (page === null) return null
  const selected = isSelected(page)

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent
        className="flex max-h-[92vh] flex-col gap-3 sm:max-w-3xl"
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' && page > 1) onNavigate(page - 1)
          if (e.key === 'ArrowRight' && page < pageCount) onNavigate(page + 1)
        }}
      >
        <DialogHeader>
          <DialogTitle>
            Səhifə {page} / {pageCount}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Səhifə önbaxışı — ox düymələri ilə vərəqləyin.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-white">
          {src ? (
            <img
              src={src}
              alt={`Səhifə ${page}`}
              className="w-full"
              draggable={false}
            />
          ) : (
            <Skeleton className="aspect-[1/1.41] w-full" />
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label="Əvvəlki səhifə"
            disabled={page <= 1}
            onClick={() => onNavigate(page - 1)}
          >
            <ChevronLeft />
          </Button>

          <Button
            variant={selected ? 'secondary' : 'default'}
            onClick={() => onToggleSelected(page)}
          >
            {selected ? (
              <>
                <Check data-icon="inline-start" />
                Aralıqdadır — çıxar
              </>
            ) : (
              <>
                <Plus data-icon="inline-start" />
                Aralığa əlavə et
              </>
            )}
          </Button>

          <Button
            variant="outline"
            size="icon"
            aria-label="Növbəti səhifə"
            disabled={page >= pageCount}
            onClick={() => onNavigate(page + 1)}
          >
            <ChevronRight />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

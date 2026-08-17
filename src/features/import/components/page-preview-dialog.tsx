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
  const [renderFailed, setRenderFailed] = useState(false)
  const [renderAttempt, setRenderAttempt] = useState(0)

  // A different doc means a different cache; the component stays mounted.
  useEffect(() => {
    cache.current = new Map()
  }, [doc])

  useEffect(() => {
    if (page === null) return
    setRenderFailed(false)
    const cached = cache.current.get(page)
    if (cached) {
      setSrc(cached)
      return
    }
    setSrc(null)
    let cancelled = false
    void (async () => {
      try {
        const pdfPage = await doc.getPage(page)
        if (cancelled) return
        const base = pdfPage.getViewport({ scale: 1 })
        const viewport = pdfPage.getViewport({
          scale: RENDER_WIDTH / base.width,
        })
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
      } catch (error) {
        console.error('preview render failed', page, error)
        if (!cancelled) setRenderFailed(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [doc, page, renderAttempt])

  // Arrow keys work regardless of where focus sits: a chevron that becomes
  // disabled at a page boundary drops focus to <body>, which a DialogContent
  // onKeyDown never hears — so listen on document while the dialog is open.
  useEffect(() => {
    if (page === null) return
    function onKeyDown(e: KeyboardEvent) {
      if (page === null) return
      if (e.key === 'ArrowLeft' && page > 1) onNavigate(page - 1)
      if (e.key === 'ArrowRight' && page < pageCount) onNavigate(page + 1)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [page, pageCount, onNavigate])

  if (page === null) return null
  const selected = isSelected(page)

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-3 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            Səhifə {page} / {pageCount}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Səhifə önbaxışı — ox düymələri ilə vərəqləyin.
          </DialogDescription>
        </DialogHeader>

        {/* tabIndex: Safari can't scroll an unfocusable container from the
            keyboard, and the img inside is not a tab stop. */}
        <div
          tabIndex={0}
          role="region"
          aria-label={`Səhifə ${page} görüntüsü`}
          className="focus-visible:ring-ring min-h-0 flex-1 overflow-auto rounded-md border bg-white focus-visible:ring-2 focus-visible:outline-none"
        >
          {src ? (
            <img
              src={src}
              alt={`Səhifə ${page}`}
              className="w-full"
              draggable={false}
            />
          ) : renderFailed ? (
            <div className="flex aspect-[1/1.41] w-full flex-col items-center justify-center gap-3">
              <p className="text-muted-foreground text-sm">
                Səhifə göstərilə bilmədi.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRenderAttempt((n) => n + 1)}
              >
                Yenidən yoxla
              </Button>
            </div>
          ) : (
            <Skeleton className="aspect-[1/1.41] w-full" />
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          {/* aria-disabled + guard, not disabled: a hard-disabled chevron
              throws focus out of the dialog and kills arrow-key paging. */}
          <Button
            variant="outline"
            size="icon"
            aria-label="Əvvəlki səhifə"
            aria-disabled={page <= 1}
            className={page <= 1 ? 'pointer-events-none opacity-50' : undefined}
            onClick={() => page > 1 && onNavigate(page - 1)}
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
            aria-disabled={page >= pageCount}
            className={
              page >= pageCount ? 'pointer-events-none opacity-50' : undefined
            }
            onClick={() => page < pageCount && onNavigate(page + 1)}
          >
            <ChevronRight />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

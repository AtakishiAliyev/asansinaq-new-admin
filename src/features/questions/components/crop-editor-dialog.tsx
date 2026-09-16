import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { normalizeError } from '@/lib/errors'
import { isCropBox, type CropBox } from '@/core/segment/manual-band'
import { segmentPage } from '@/core/segment/segmenter'
import type { Book } from '@/features/books'
import { loadPdf, useDownloadPdf, type PDFDocumentProxy } from '@/features/import'
import { useRecropQuestion } from '@/features/questions/api/recrop'
import type { QuestionListItem } from '@/features/questions/api/questions'
import { CropBoxOverlay } from '@/features/questions/components/crop-box-overlay'

const RENDER_WIDTH = 1100

// One archived book is thirty megabytes; the operator fixing five crops on the
// same page must not download it five times. Keyed by book, kept for the tab.
const docs = new Map<number, Promise<PDFDocumentProxy>>()

interface Loaded {
  doc: PDFDocumentProxy
  src: string
  widthPt: number
  heightPt: number
  scale: number
  /** Where the segmenter would cut this question today, if it can find it. */
  suggested: CropBox | null
}

// Redrawing the box one question was cut from.
//
// The page is rendered the way the import's preview renders it, the box is
// drawn over it in the segmenter's own frame (PDF points), and Save re-cuts
// the crop through the import's own cutter and queues the row for a fresh
// read. The initial box is the one the row already carries, if a person drew
// one; otherwise the band the segmenter computes for this question right now
// — which is deterministic, and therefore never needed storing until a person
// disagreed with it.
export function CropEditorDialog({
  item,
  book,
  onClose,
  onSaved,
}: {
  item: QuestionListItem
  book: Book | undefined
  onClose: () => void
  /** Called after the row has been re-cut and queued. */
  onSaved: () => void
}) {
  const download = useDownloadPdf()
  const recrop = useRecropQuestion()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [box, setBox] = useState<CropBox | null>(null)
  const frameRef = useRef<HTMLDivElement>(null)

  const storagePath = book?.storage_path ?? null

  useEffect(() => {
    if (!book || !storagePath) return
    let cancelled = false
    setLoaded(null)
    setFailed(null)
    void (async () => {
      try {
        let pending = docs.get(book.id)
        if (!pending) {
          pending = download.mutateAsync(storagePath).then(loadPdf)
          docs.set(book.id, pending)
          // A failed download must not poison every later attempt.
          pending.catch(() => docs.delete(book.id))
        }
        const doc = await pending
        if (cancelled) return
        const page = await doc.getPage(item.page_number)
        const base = page.getViewport({ scale: 1 })
        const scale = RENDER_WIDTH / base.width
        const viewport = page.getViewport({ scale })
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('canvas 2d context alınmadı')
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        await page.render({ canvas, viewport }).promise
        if (cancelled) return
        // The segmenter's own answer for this question, as a starting point.
        // A scan has no text layer to segment; the stored box or nothing.
        let suggested: CropBox | null = null
        if (!item.is_scan) {
          const seg = await segmentPage(page)
          const band = seg.bands.find((b) => b.col === item.col && b.number === item.q_no)
          if (band) suggested = { ...band.bbox }
        }
        if (cancelled) return
        setLoaded({
          doc,
          src: canvas.toDataURL('image/jpeg', 0.9),
          widthPt: base.width,
          heightPt: base.height,
          scale,
          suggested,
        })
        const stored = isCropBox(item.crop_box) ? item.crop_box : null
        setBox(
          stored ??
            suggested ?? {
              x: base.width * 0.1,
              y: base.height * 0.1,
              w: base.width * 0.8,
              h: base.height * 0.2,
            },
        )
      } catch (error) {
        console.error('crop editor load failed', item.id, error)
        if (!cancelled) setFailed(normalizeError(error).message)
      }
    })()
    return () => {
      cancelled = true
    }
    // The download mutation object is stable for the component's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, storagePath, item.id, item.page_number, item.col, item.q_no, item.is_scan, item.crop_box])

  function save() {
    if (!loaded || !box) return
    recrop.mutate(
      { row: item, doc: loaded.doc, box },
      {
        onSuccess: () => {
          toast.success('Krop yeniləndi, sual növbəyə salındı')
          onSaved()
        },
        onError: (error) => toast.error(normalizeError(error).message),
      },
    )
  }

  const busy = recrop.isPending
  const pt = (v: number) => Math.round(v)

  return (
    <Dialog open onOpenChange={(open) => (!open && !busy ? onClose() : undefined)}>
      <DialogContent className="flex max-h-[94vh] flex-col gap-3 sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            Kropu düzəlt — s.{item.page_number} · sual {item.q_no}
          </DialogTitle>
          <DialogDescription>
            Qutunu sürüşdürün və ya kənarlarından çəkin. Saxlayanda sual bu
            qutudan yenidən kəsilir və oxunmaq üçün növbəyə düşür.
          </DialogDescription>
        </DialogHeader>

        <div
          ref={frameRef}
          className="min-h-0 flex-1 overflow-auto rounded-md border bg-white"
        >
          {!book || !storagePath ? (
            <p className="text-muted-foreground p-6 text-sm">
              Bu kitabın PDF-i arxivdə yoxdur, ona görə səhifəsi göstərilə
              bilmir. Kitabı yenidən idxal edin, sonra buradan kəsin.
            </p>
          ) : failed ? (
            <p className="text-destructive p-6 text-sm">
              Səhifə yüklənmədi: {failed}
            </p>
          ) : !loaded || !box ? (
            <Skeleton className="aspect-[1/1.41] w-full" />
          ) : (
            <div className="relative" style={{ width: RENDER_WIDTH }}>
              <img
                src={loaded.src}
                alt={`Səhifə ${item.page_number}`}
                width={RENDER_WIDTH}
                draggable={false}
                className="block select-none"
              />
              <CropBoxOverlay
                box={box}
                pageWidthPt={loaded.widthPt}
                pageHeightPt={loaded.heightPt}
                scale={loaded.scale}
                onChange={setBox}
              />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {box ? (
            <span className="text-muted-foreground font-mono text-xs tabular-nums">
              x {pt(box.x)} · y {pt(box.y)} · {pt(box.w)} × {pt(box.h)} pt
            </span>
          ) : null}
          {loaded?.suggested && box ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setBox(loaded.suggested)}
            >
              Seqmenterin qutusuna qaytar
            </Button>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" disabled={busy} onClick={onClose}>
              İmtina
            </Button>
            <Button disabled={!loaded || !box || busy} onClick={save}>
              {busy ? <Spinner data-icon="inline-start" /> : null}
              Kəs və növbəyə sal
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

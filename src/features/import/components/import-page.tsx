import { useEffect, useRef, useState } from 'react'
import { Eye, FileUp, Play, Send, Square } from 'lucide-react'
import { useBlocker, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { normalizeError } from '@/lib/errors'
import {
  formatPages,
  parsePageRange,
  parsePagesLenient,
} from '@/core/segment/page-range'
import {
  BookFormDialog,
  findBookByHash,
  sha256Hex,
  titleFromFilename,
  useBackfillPageCount,
  useBooks,
  useCreateBook,
  useMarkPagesWorked,
  type Book,
} from '@/features/books'
import { useDownloadPdf } from '@/features/import/api/use-download-pdf'
import { BookPicker } from '@/features/import/components/book-picker'
import { CropGrid } from '@/features/import/components/crop-grid'
import { PagePreviewDialog } from '@/features/import/components/page-preview-dialog'
import { ThumbnailStrip } from '@/features/import/components/thumbnail-strip'
import { useSegmentation } from '@/features/import/hooks/use-segmentation'
import {
  cropKey,
  RecreationCheckDialog,
  useSaveCrops,
  useStructuringRun,
  type SaveCropsResult,
} from '@/features/questions'
import { loadPdf, type PDFDocumentProxy } from '@/features/import/lib/pdf'
import { usePageTitle } from '@/hooks/use-page-title'

interface PendingBook {
  file: File
  hash: string
  pageCount: number | null
}

interface DuplicateHit {
  book: Book
  file: File
}

export function ImportPage() {
  usePageTitle('İmport')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [docSeq, setDocSeq] = useState(0)
  const loadSeq = useRef(0)
  const docRef = useRef<PDFDocumentProxy | null>(null)
  // The parse started at file-pick time; committed to the viewer only after
  // the metadata dialog is confirmed.
  const pendingDocRef = useRef<Promise<PDFDocumentProxy> | null>(null)
  // ?book=ID auto-open bookkeeping — reset on unmount so a remount (incl.
  // StrictMode's simulated one) handles the param again.
  const handledBook = useRef<number | null>(null)
  const [pendingBook, setPendingBook] = useState<PendingBook | null>(null)
  const [duplicate, setDuplicate] = useState<DuplicateHit | null>(null)
  // Hash + duplicate-check gap after the OS picker closes needs a visible
  // pending state — on a 45MB file it is a multi-second silence otherwise.
  const [isChecking, setIsChecking] = useState(false)
  // Opening another document mid-run silently kills the run; the operator
  // confirms first, and the confirmed action runs from here.
  const [pendingReplace, setPendingReplace] = useState<(() => void) | null>(
    null,
  )
  const [archiveBadge, setArchiveBadge] = useState<
    'uploaded' | 'skipped-size' | null
  >(null)
  const [previewPage, setPreviewPage] = useState<number | null>(null)
  // The book the open document belongs to — the processing trail hangs off it.
  const [currentBook, setCurrentBook] = useState<Book | null>(null)
  const [rangeInput, setRangeInput] = useState('')
  const [rangeError, setRangeError] = useState<string | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const books = useBooks()
  const createBook = useCreateBook()
  const backfillPageCount = useBackfillPageCount()
  const markPagesWorked = useMarkPagesWorked()
  const download = useDownloadPdf()
  const segmentation = useSegmentation()
  const saveCrops = useSaveCrops()
  const structuring = useStructuringRun()
  const [savedEntries, setSavedEntries] = useState<SaveCropsResult['saved']>([])
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [sendConfirmOpen, setSendConfirmOpen] = useState(false)
  const [checkOpen, setCheckOpen] = useState(false)

  useEffect(
    () => () => {
      // Supersede any in-flight load so a parse resolving after unmount
      // destroys itself in commitLoaded instead of repopulating a dead ref.
      loadSeq.current += 1
      handledBook.current = null
      void docRef.current?.loadingTask.destroy().catch(() => {})
      const pending = pendingDocRef.current
      pendingDocRef.current = null
      void pending?.then((d) => d.loadingTask.destroy()).catch(() => {})
    },
    [],
  )

  function commitLoaded(
    seq: number,
    name: string,
    loaded: PDFDocumentProxy,
    opts: {
      badge?: 'uploaded' | 'skipped-size' | null
      book?: Book | null
      initialRange?: string
    } = {},
  ) {
    if (seq !== loadSeq.current) {
      void loaded.loadingTask.destroy().catch(() => {})
      return
    }
    void docRef.current?.loadingTask.destroy().catch(() => {})
    docRef.current = loaded
    segmentation.reset()
    structuring.reset()
    setSavedEntries([])
    setSelectedKeys(new Set())
    setRangeInput(opts.initialRange ?? '')
    setRangeError(null)
    setFileName(name)
    setDoc(loaded)
    setDocSeq(seq)
    setArchiveBadge(opts.badge ?? null)
    setCurrentBook(opts.book ?? null)
    setPreviewPage(null)
  }

  async function openBuffer(
    seq: number,
    name: string,
    buffer: Promise<ArrayBuffer>,
    opts: { book?: Book | null; initialRange?: string } = {},
  ) {
    try {
      const loaded = await loadPdf(await buffer)
      commitLoaded(seq, name, loaded, opts)
    } catch (error) {
      if (seq !== loadSeq.current) return
      toast.error(normalizeError(error).message)
    }
  }

  // New file: hash → duplicate check → metadata dialog. The PDF parse runs in
  // parallel so the page count is ready by the time the admin fills the form.
  async function handleFile(file: File) {
    let docPromise: Promise<PDFDocumentProxy> | undefined
    setIsChecking(true)
    try {
      const buffer = await file.arrayBuffer()
      const hash = await sha256Hex(buffer)
      const existing = await findBookByHash(hash).catch(() => null)
      if (existing) {
        setIsChecking(false)
        setDuplicate({ book: existing, file })
        return
      }
      // Release a previous still-pending parse before replacing it.
      const previous = pendingDocRef.current
      if (previous)
        void previous.then((d) => d.loadingTask.destroy()).catch(() => {})
      docPromise = loadPdf(buffer)
      pendingDocRef.current = docPromise
      setPendingBook({ file, hash, pageCount: null })
      // The metadata dialog is open from here on — the badge's job is done.
      setIsChecking(false)
      const loaded = await docPromise
      setPendingBook((current) =>
        current && current.file === file
          ? { ...current, pageCount: loaded.numPages }
          : current,
      )
    } catch (error) {
      // Only the call that still owns the pending state may clear it — a late
      // rejection from an older pick must not close a newer pick's dialog.
      if (docPromise && pendingDocRef.current !== docPromise) return
      setIsChecking(false)
      pendingDocRef.current = null
      setPendingBook((current) =>
        current && current.file === file ? null : current,
      )
      toast.error(normalizeError(error).message)
    }
  }

  function cancelPending() {
    const promise = pendingDocRef.current
    pendingDocRef.current = null
    setPendingBook(null)
    void promise?.then((d) => d.loadingTask.destroy()).catch(() => {})
  }

  // First page the operator has not touched yet — the "continue from" hint.
  function nextUnworkedPage(book: Book): number | null {
    if (!book.page_count) return null
    const worked = new Set(book.worked_pages)
    for (let p = 1; p <= book.page_count; p++) {
      if (!worked.has(p)) return p
    }
    return null
  }

  function openStoredBook(book: Book) {
    if (!book.storage_path) return
    const seq = ++loadSeq.current
    const next = nextUnworkedPage(book)
    void openBuffer(seq, book.title, download.mutateAsync(book.storage_path), {
      book,
      initialRange:
        next !== null && book.worked_pages.length > 0 ? String(next) : '',
    })
  }

  // /import?book=ID — the Kitablar page's "open in import" action.
  useEffect(() => {
    const id = Number(searchParams.get('book'))
    if (!id || !books.data) return
    if (handledBook.current === id) return
    handledBook.current = id
    const book = books.data.find((b) => b.id === id)
    setSearchParams({}, { replace: true })
    if (book?.storage_path) openStoredBook(book)
    else if (book) toast.error('Bu kitabın arxiv faylı yoxdur')
    else toast.error('Kitab tapılmadı')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires when the list arrives
  }, [books.data, searchParams])

  // The auto-open can't run while the archive list is failing; say so instead
  // of silently ignoring the ?book param (it stays, so a retry resumes it).
  useEffect(() => {
    if (books.isError && searchParams.get('book')) {
      toast.error('Arxiv siyahısı yüklənmədi — kitab avtomatik açıla bilmədi')
    }
  }, [books.isError, searchParams])

  function toggleThumb(page: number) {
    if (!doc) return
    const strict = parsePageRange(rangeInput, doc.numPages)
    if (strict.ok || rangeInput.trim() === '') {
      const pages = parsePagesLenient(rangeInput, doc.numPages)
      if (pages.has(page)) pages.delete(page)
      else pages.add(page)
      setRangeInput(formatPages([...pages]))
    } else {
      setRangeInput(rangeInput.trim() ? `${rangeInput}, ${page}` : String(page))
    }
    setRangeError(null)
  }

  function startSegmentation() {
    if (!doc || segmentation.status === 'running') return
    const parsed = parsePageRange(rangeInput, doc.numPages)
    if (!parsed.ok) {
      setRangeError(parsed.error)
      return
    }
    setRangeError(null)
    const book = currentBook
    void segmentation
      .run(doc, parsed.pages)
      .then((results) => {
        if (!book || !results) return
        // A page counts as worked when it was really processed — text-path
        // pages always, scan pages only if the AI actually found questions.
        const pages = results
          .filter((r) => !r.isScan || r.crops.length > 0)
          .map((r) => r.pageNumber)
        if (pages.length) markPagesWorked.mutate({ bookId: book.id, pages })
        // Crops are free — persist ALL of them as draft questions; the paid
        // structuring step is a separate, operator-selected action below.
        saveCrops.mutate(
          { book, results },
          {
            onSuccess: (res) => {
              setSavedEntries(res.saved)
              setSelectedKeys(new Set())
            },
          },
        )
      })
      // run() catches per-page errors itself; this is the last-resort net.
      .catch((error) => toast.error(normalizeError(error).message))
  }

  const running = segmentation.status === 'running'
  // With a book open, crops persist on completion — only live runs and
  // bookless (ephemeral) results still need the leave guard.
  const dirty =
    running ||
    structuring.status === 'running' ||
    saveCrops.isPending ||
    (segmentation.results.length > 0 && !currentBook)

  const blocker = useBlocker(dirty)

  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  function guardReplace(action: () => void) {
    if (running || structuring.status === 'running') {
      setPendingReplace(() => action)
    } else {
      action()
    }
  }

  const structuringRunning = structuring.status === 'running'
  const structuredKeys = new Set(structuring.items.map((i) => cropKey(i.crop)))
  const eligibleKeys = new Set(
    savedEntries
      .filter((e) => !structuredKeys.has(cropKey(e.crop)))
      .map((e) => cropKey(e.crop)),
  )
  const selectedEntries = savedEntries.filter(
    (e) => selectedKeys.has(cropKey(e.crop)) && eligibleKeys.has(cropKey(e.crop)),
  )
  // Rough per-lane cost constants (documented estimates, not billing).
  const laneCounts = { none: 0, rule: 0, colored: 0 }
  for (const e of selectedEntries) laneCounts[e.crop.figureKind]++
  const costEstimate =
    laneCounts.none * 0.006 + laneCounts.rule * 0.03 + laneCounts.colored * 0.16

  function toggleSelected(key: string) {
    setSelectedKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function startStructuring() {
    setSendConfirmOpen(false)
    setSelectedKeys(new Set())
    void structuring
      .run(selectedEntries.map((e) => ({ row: e.row, crop: e.crop })))
      .then((items) => {
        if (!items.length) return
        const failed = items.filter((i) => i.status === 'failed').length
        ;(failed ? toast.warning : toast.success)(
          `${items.length - failed} sual strukturlaşdırıldı${failed ? `, ${failed} alınmadı` : ''}`,
        )
      })
      .catch((error) => toast.error(normalizeError(error).message))
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">İmport</h1>

      <Card>
        <CardContent className="flex flex-col gap-4">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) guardReplace(() => void handleFile(file))
              e.target.value = ''
            }}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={isChecking}
              onClick={() => fileInputRef.current?.click()}
            >
              <FileUp data-icon="inline-start" />
              PDF yüklə
            </Button>
            <BookPicker
              disabled={download.isPending}
              onPick={(book) => guardReplace(() => openStoredBook(book))}
            />
            {download.isPending ? (
              <Badge variant="secondary">arxivdən endirilir…</Badge>
            ) : null}
            {isChecking ? (
              <Badge variant="secondary">
                <Spinner />
                yoxlanılır…
              </Badge>
            ) : null}
            {fileName ? (
              <span className="min-w-0 truncate text-sm">{fileName}</span>
            ) : (
              <span className="text-muted-foreground text-sm">
                Yeni PDF yükləyin və ya arxivdən kitab seçin.
              </span>
            )}
            {archiveBadge === 'uploaded' ? (
              <Badge variant="secondary">arxivləndi</Badge>
            ) : null}
            {archiveBadge === 'skipped-size' ? (
              <Badge variant="outline">
                arxivlənmədi — 50MB limitindən böyükdür
              </Badge>
            ) : null}
          </div>

          {doc ? (
            <>
              <ThumbnailStrip
                key={docSeq}
                doc={doc}
                pageCount={doc.numPages}
                selected={parsePagesLenient(rangeInput, doc.numPages)}
                onOpen={setPreviewPage}
              />
              <Field data-invalid={rangeError ? true : undefined}>
                <FieldLabel htmlFor="range">Səhifə aralığı</FieldLabel>
                <div className="flex gap-2">
                  <Input
                    id="range"
                    value={rangeInput}
                    placeholder="məs. 4-8, 11"
                    className="max-w-60"
                    aria-invalid={rangeError ? true : undefined}
                    onChange={(e) => {
                      setRangeInput(e.target.value)
                      setRangeError(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') startSegmentation()
                    }}
                  />
                  <Button onClick={startSegmentation} disabled={running}>
                    {running ? (
                      <Spinner data-icon="inline-start" />
                    ) : (
                      <Play data-icon="inline-start" />
                    )}
                    Sualları çıxar
                  </Button>
                </div>
                {rangeError ? (
                  <p className="text-destructive text-sm">{rangeError}</p>
                ) : (
                  <FieldDescription>
                    Yazı ilə (4-8, 11) və ya yuxarıdakı səhifələrə kliklə seçin
                    — cəmi {doc.numPages} səhifə.
                  </FieldDescription>
                )}
              </Field>
              <PagePreviewDialog
                doc={doc}
                pageCount={doc.numPages}
                page={previewPage}
                isSelected={(page) =>
                  parsePagesLenient(rangeInput, doc.numPages).has(page)
                }
                onToggleSelected={toggleThumb}
                onNavigate={setPreviewPage}
                onClose={() => setPreviewPage(null)}
              />
            </>
          ) : null}
        </CardContent>
      </Card>

      {running ? (
        <div className="flex items-center gap-3">
          <Progress
            value={(segmentation.current / Math.max(1, segmentation.total)) * 100}
            className="h-2 flex-1"
          />
          <span className="text-muted-foreground shrink-0 text-sm tabular-nums">
            {segmentation.current}/{segmentation.total} səhifə
          </span>
          <Button variant="outline" size="sm" onClick={segmentation.stop}>
            <Square data-icon="inline-start" />
            Dayandır
          </Button>
        </div>
      ) : null}

      {segmentation.results.length > 0 ? (
        <CropGrid
          results={segmentation.results}
          selection={
            eligibleKeys.size > 0 && !structuringRunning
              ? {
                  eligible: eligibleKeys,
                  selected: selectedKeys,
                  onToggle: toggleSelected,
                }
              : undefined
          }
        />
      ) : null}

      {eligibleKeys.size > 0 && !structuringRunning ? (
        <div className="bg-background sticky bottom-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border p-2 shadow-xs">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedKeys(new Set(eligibleKeys))}
          >
            Hamısını seç ({eligibleKeys.size})
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={selectedKeys.size === 0}
            onClick={() => setSelectedKeys(new Set())}
          >
            Təmizlə
          </Button>
          <div className="ml-auto flex items-center gap-2">
            {structuring.items.length > 0 ? (
              <Button variant="outline" size="sm" onClick={() => setCheckOpen(true)}>
                <Eye data-icon="inline-start" />
                Nəticələrə bax ({structuring.items.length})
              </Button>
            ) : null}
            <Button
              size="sm"
              disabled={selectedEntries.length === 0}
              onClick={() => setSendConfirmOpen(true)}
            >
              <Send data-icon="inline-start" />
              Çıxarılmaya göndər ({selectedEntries.length})
            </Button>
          </div>
        </div>
      ) : null}

      {structuringRunning ? (
        <div className="flex items-center gap-3">
          <Progress
            value={(structuring.current / Math.max(1, structuring.total)) * 100}
            className="h-2 flex-1"
          />
          <span className="text-muted-foreground shrink-0 text-sm tabular-nums">
            {structuring.current}/{structuring.total} sual strukturlaşdırılır
          </span>
          <Button variant="outline" size="sm" onClick={structuring.stop}>
            <Square data-icon="inline-start" />
            Dayandır
          </Button>
        </div>
      ) : null}
      {!structuringRunning && structuring.items.length > 0 && eligibleKeys.size === 0 ? (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => setCheckOpen(true)}>
            <Eye data-icon="inline-start" />
            Nəticələrə bax ({structuring.items.length})
          </Button>
        </div>
      ) : null}

      {segmentation.status === 'done' &&
      segmentation.results.every((r) => r.crops.length === 0) ? (
        <Alert>
          <AlertDescription>
            Seçilən səhifələrdə sual tapılmadı.
            {segmentation.results.some((r) => r.isScan)
              ? ' Skan səhifələrdə AI aşkarlanması alınmadı — səhifə qeydlərinə baxın.'
              : ' Fərqli aralıq yoxlayın və ya səhifə strukturu dəstəklənmir.'}
          </AlertDescription>
        </Alert>
      ) : null}

      {pendingBook ? (
        <BookFormDialog
          open
          title="Yeni kitab"
          description={`${pendingBook.file.name} — ${(pendingBook.file.size / 1024 / 1024).toFixed(1)} MB${pendingBook.pageCount ? `, ${pendingBook.pageCount} səhifə` : ''}`}
          submitLabel="Yüklə və aç"
          isPending={createBook.isPending}
          defaults={{
            title: titleFromFilename(pendingBook.file.name),
            program_id: 0,
            subject_id: null,
            tags: [],
            note: '',
          }}
          onCancel={cancelPending}
          onSubmit={(form) =>
            createBook.mutate(
              {
                form,
                file: pendingBook.file,
                contentHash: pendingBook.hash,
                pageCount: pendingBook.pageCount,
              },
              {
                onSuccess: async ({ book, archive }) => {
                  const promise = pendingDocRef.current
                  pendingDocRef.current = null
                  setPendingBook(null)
                  if (!promise) return
                  const seq = ++loadSeq.current
                  try {
                    const loaded = await promise
                    // The dialog can be submitted before the parse resolves;
                    // fill the page count in once it is known.
                    if (book.page_count === null) {
                      backfillPageCount.mutate({
                        id: book.id,
                        pageCount: loaded.numPages,
                      })
                    }
                    commitLoaded(seq, book.title, loaded, {
                      badge: archive,
                      book,
                    })
                  } catch (error) {
                    toast.error(normalizeError(error).message)
                  }
                },
              },
            )
          }
        />
      ) : null}

      <AlertDialog
        open={duplicate !== null}
        onOpenChange={(open) => {
          if (!open) setDuplicate(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Bu PDF artıq arxivdədir</AlertDialogTitle>
            <AlertDialogDescription>
              Eyni fayl «{duplicate?.book.title}» adı ilə qeydiyyatdadır —
              yenidən yükləməyə ehtiyac yoxdur.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>İmtina</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!duplicate) return
                if (duplicate.book.storage_path) {
                  openStoredBook(duplicate.book)
                } else {
                  const seq = ++loadSeq.current
                  void openBuffer(
                    seq,
                    duplicate.book.title,
                    duplicate.file.arrayBuffer(),
                    { book: duplicate.book },
                  )
                }
                setDuplicate(null)
              }}
            >
              Kitabı aç
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Leaving /import with unsaved crops (or a live run) needs a yes. */}
      <AlertDialog
        open={blocker.state === 'blocked'}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Emal nəticələri itəcək</AlertDialogTitle>
            <AlertDialogDescription>
              {running
                ? 'Emal hələ davam edir. Səhifəni tərk etsəniz, dayandırılacaq və çıxarılan suallar silinəcək.'
                : 'Çıxarılan suallar bu mərhələdə yaddaşda saxlanmır — səhifəni tərk etdikdə silinəcək.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => blocker.reset?.()}>
              Qal
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                segmentation.stop()
                blocker.proceed?.()
              }}
            >
              Tərk et
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Paid step: show the lane mix and the price before any model runs. */}
      <AlertDialog
        open={sendConfirmOpen}
        onOpenChange={(open) => {
          if (!open) setSendConfirmOpen(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {selectedEntries.length} sual çıxarılmaya göndərilsin?
            </AlertDialogTitle>
            <AlertDialogDescription>
              AI hər sualı təmiz formada yenidən yaradacaq (mətn, variantlar,
              fiqurlar). Təxmini xərc: ≈ ${costEstimate.toFixed(2)}
              {laneCounts.colored > 0 || laneCounts.rule > 0
                ? ` (mətn: ${laneCounts.none}, sxem: ${laneCounts.rule}, rəngli fiqur: ${laneCounts.colored}; şəkilli variantlar xərci artıra bilər)`
                : ''}
              . Nəticələr bazaya yazılır və sonra yoxlanıla bilər.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>İmtina</AlertDialogCancel>
            <AlertDialogAction onClick={startStructuring}>
              Göndər
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <RecreationCheckDialog
        items={structuring.items}
        open={checkOpen}
        onClose={() => setCheckOpen(false)}
      />

      {/* Opening another PDF/book while a run is live also needs a yes. */}
      <AlertDialog
        open={pendingReplace !== null}
        onOpenChange={(open) => {
          if (!open) setPendingReplace(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Emal davam edir</AlertDialogTitle>
            <AlertDialogDescription>
              Yeni sənəd açılsa, gedən emal dayandırılacaq və çıxarılan suallar
              silinəcək.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>İmtina</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const action = pendingReplace
                setPendingReplace(null)
                segmentation.stop()
                action?.()
              }}
            >
              Dayandır və aç
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

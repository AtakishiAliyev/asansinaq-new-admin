import { useEffect, useRef, useState } from 'react'
import { FileUp, KeyRound, Play, Send, Square } from 'lucide-react'
import { useBlocker, useNavigate, useSearchParams } from 'react-router'
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
import { matchBlockToSection } from '@/core/answer-key/match'
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
  AnswerKeyDialog,
  cropKey,
  useAnswerKeyRun,
  useEnqueue,
  useSaveAnswerKeys,
  useSaveCrops,
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
  // Questions and answer keys are different page sets — one shared input meant
  // retyping the other every time you switched task. Clicking a thumbnail
  // fills whichever field the operator last touched.
  const [keyRangeInput, setKeyRangeInput] = useState('')
  const [keyRangeError, setKeyRangeError] = useState<string | null>(null)
  const [activeRange, setActiveRange] = useState<'questions' | 'keys'>('questions')
  const [searchParams, setSearchParams] = useSearchParams()
  const books = useBooks()
  const createBook = useCreateBook()
  const backfillPageCount = useBackfillPageCount()
  const markPagesWorked = useMarkPagesWorked()
  const download = useDownloadPdf()
  const segmentation = useSegmentation()
  const saveCrops = useSaveCrops()
  const enqueue = useEnqueue()
  const navigate = useNavigate()
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [sendConfirmOpen, setSendConfirmOpen] = useState(false)
  /** Crops already written and queued. They stop arming the unsaved-work guard. */
  const [sentKeys, setSentKeys] = useState<Set<string>>(new Set())
  const answerKeys = useAnswerKeyRun()
  const saveAnswerKeys = useSaveAnswerKeys()
  const [keyDialogOpen, setKeyDialogOpen] = useState(false)

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
    answerKeys.reset()
    setSelectedKeys(new Set())
    setRangeInput(opts.initialRange ?? '')
    setRangeError(null)
    setKeyRangeInput('')
    setKeyRangeError(null)
    setActiveRange('questions')
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
    const isKeys = activeRange === 'keys'
    const value = isKeys ? keyRangeInput : rangeInput
    const setValue = isKeys ? setKeyRangeInput : setRangeInput
    const setError = isKeys ? setKeyRangeError : setRangeError
    const strict = parsePageRange(value, doc.numPages)
    if (strict.ok || value.trim() === '') {
      const pages = parsePagesLenient(value, doc.numPages)
      if (pages.has(page)) pages.delete(page)
      else pages.add(page)
      setValue(formatPages([...pages]))
    } else {
      setValue(value.trim() ? `${value}, ${page}` : String(page))
    }
    setError(null)
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
      })
      // run() catches per-page errors itself; this is the last-resort net.
      .catch((error) => toast.error(normalizeError(error).message))
  }

  const running = segmentation.status === 'running'
  // Answer keys read the SAME page-range input in a different mode: the
  // operator is already looking at the book with the page numbers in view.
  function startAnswerKeys() {
    if (!doc || !currentBook) return
    const parsed = parsePageRange(keyRangeInput, doc.numPages)
    if (!parsed.ok) {
      setKeyRangeError(parsed.error)
      return
    }
    setKeyRangeError(null)
    void answerKeys
      .run(doc, parsed.pages, currentBook.id)
      .then((result) => {
        if (!result.blocks.length) {
          toast.warning('Seçilən səhifələrdə cavab açarı tapılmadı')
          return
        }
        setKeyDialogOpen(true)
      })
      .catch((error) => toast.error(normalizeError(error).message))
  }

  function applyAnswerKeys(overrides: Map<number, number>) {
    const match = answerKeys.match
    if (!currentBook || !match) return
    // An override re-matches the block against the chosen section, so the
    // operator's correction decides which questions get the answers.
    const pairs = match.blocks.flatMap((block, i) => {
      const sectionIndex = overrides.get(i)
      if (sectionIndex === undefined) {
        return block.pairs.map((p) => ({ id: p.id, answer: p.answer }))
      }
      const section = match.sections.find((s) => s.index === sectionIndex)
      if (!section) return []
      return matchBlockToSection(
        block.block,
        answerKeys.questions.filter(
          (q) => q.pageNumber >= section.from && q.pageNumber <= section.to,
        ),
      ).pairs.map((pair) => ({ id: pair.id, answer: pair.answer }))
    })
    saveAnswerKeys.mutate(
      { bookId: currentBook.id, blocks: answerKeys.blocks, pairs },
      {
        onSuccess: () => {
          setKeyDialogOpen(false)
          answerKeys.reset()
        },
      },
    )
  }

  // Crops stay in memory until the operator SENDS them — only selected crops
  // are persisted (as rows + storage objects) right before queueing, so the
  // bank never fills with drafts nobody asked for.
  const allCrops = segmentation.results.flatMap((page) => page.crops)
  // What is actually at risk: crops that were never sent.
  const hasUnsentCrops = allCrops.some((c) => !sentKeys.has(cropKey(c)))
  // Crops persist only when SENT — leaving with unsent results discards them
  // (recoverable by re-running the range, but usually accidental).
  const dirty =
    running || saveCrops.isPending || hasUnsentCrops

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
    if (running) {
      setPendingReplace(() => action)
    } else {
      action()
    }
  }

  const eligibleKeys = new Set(
    currentBook
      ? allCrops
          .map((c) => cropKey(c))
          .filter((key) => !sentKeys.has(key))
      : [],
  )
  const selectedCrops = allCrops.filter(
    (c) => selectedKeys.has(cropKey(c)) && eligibleKeys.has(cropKey(c)),
  )
  // Rough per-lane cost constants (documented estimates, not billing). The
  // scheme lane is a range, not a number: a `rule` crop whose DSL render fails
  // escalates to image generation, so $0.03 is its floor and $0.18 its ceiling.
  const laneCounts = { none: 0, rule: 0, colored: 0 }
  for (const c of selectedCrops) laneCounts[c.figureKind]++
  const costBase = laneCounts.none * 0.006 + laneCounts.colored * 0.16
  const costLow = costBase + laneCounts.rule * 0.03
  const costHigh = costBase + laneCounts.rule * 0.18

  function toggleSelected(key: string) {
    setSelectedKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function sendToQueue() {
    setSendConfirmOpen(false)
    const book = currentBook
    if (!book) return
    const selectedResults = segmentation.results
      .map((page) => ({
        ...page,
        crops: page.crops.filter((c) => selectedKeys.has(cropKey(c))),
      }))
      .filter((page) => page.crops.length > 0)
    setSelectedKeys(new Set())
    // Persist ONLY what is being sent, then queue exactly those rows.
    //
    // There is no "structure in this tab" any more. Draining questions belongs
    // to the worker: it batches them at half price, is not bounded by an Edge
    // Function's wall clock, and does not stop when the tab closes. What this
    // page owes the operator is the crops and a place in the queue.
    saveCrops.mutate(
      { book, results: selectedResults },
      {
        onSuccess: (res) => {
          if (!res.saved.length) return
          // Sent crops stop arming the unsaved-work guard: they are rows now,
          // and leaving the page no longer loses them.
          setSentKeys((prev) => {
            const next = new Set(prev)
            for (const entry of res.saved) next.add(cropKey(entry.crop))
            return next
          })
          void enqueue
            .mutateAsync(res.saved.map((e) => e.row.id))
            .then(() =>
              toast.info(`${res.saved.length} sual növbəyə əlavə edildi`, {
                action: {
                  label: 'Suallara keç',
                  onClick: () => navigate('/questions'),
                },
              }),
            )
            .catch(() => undefined)
        },
        onError: (error) => toast.error(normalizeError(error).message),
      },
    )
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
                selected={parsePagesLenient(
                  activeRange === 'keys' ? keyRangeInput : rangeInput,
                  doc.numPages,
                )}
                onOpen={setPreviewPage}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field data-invalid={rangeError ? true : undefined}>
                  <FieldLabel htmlFor="range">Sual səhifələri</FieldLabel>
                  <div className="flex gap-2">
                    <Input
                      id="range"
                      value={rangeInput}
                      placeholder="məs. 4-8, 11"
                      aria-invalid={rangeError ? true : undefined}
                      onFocus={() => setActiveRange('questions')}
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
                      Çıxar
                    </Button>
                  </div>
                  {rangeError ? (
                    <p className="text-destructive text-sm">{rangeError}</p>
                  ) : (
                    <FieldDescription>
                      {activeRange === 'questions'
                        ? 'Səhifələrə kliklə seçim bu sahəyə düşür.'
                        : 'Kliklə seçim üçün bu sahəyə toxunun.'}
                    </FieldDescription>
                  )}
                </Field>

                <Field data-invalid={keyRangeError ? true : undefined}>
                  <FieldLabel htmlFor="key-range">
                    Cavab açarı səhifələri
                  </FieldLabel>
                  <div className="flex gap-2">
                    <Input
                      id="key-range"
                      value={keyRangeInput}
                      placeholder="məs. 11, 19"
                      aria-invalid={keyRangeError ? true : undefined}
                      onFocus={() => setActiveRange('keys')}
                      onChange={(e) => {
                        setKeyRangeInput(e.target.value)
                        setKeyRangeError(null)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') startAnswerKeys()
                      }}
                    />
                    <Button
                      variant="outline"
                      onClick={startAnswerKeys}
                      disabled={
                        running ||
                        answerKeys.status === 'running' ||
                        !currentBook ||
                        !keyRangeInput.trim()
                      }
                      title={
                        currentBook
                          ? 'Seçilən səhifələri cavab açarı kimi oxu'
                          : 'Əvvəlcə arxivdən kitab açın'
                      }
                    >
                      {answerKeys.status === 'running' ? (
                        <Spinner data-icon="inline-start" />
                      ) : (
                        <KeyRound data-icon="inline-start" />
                      )}
                      Oxu
                    </Button>
                  </div>
                  {keyRangeError ? (
                    <p className="text-destructive text-sm">{keyRangeError}</p>
                  ) : (
                    <FieldDescription>
                      {currentBook
                        ? 'Cavabların çap olunduğu səhifələr.'
                        : 'Kitab açıldıqdan sonra aktivləşir.'}
                    </FieldDescription>
                  )}
                </Field>
              </div>

              <p className="text-muted-foreground text-xs">
                Yazı ilə (4-8, 11) və ya yuxarıdakı səhifələrə kliklə seçin —
                cəmi {doc.numPages} səhifə.
              </p>

              <PagePreviewDialog
                doc={doc}
                pageCount={doc.numPages}
                page={previewPage}
                isSelected={(page) =>
                  parsePagesLenient(
                    activeRange === 'keys' ? keyRangeInput : rangeInput,
                    doc.numPages,
                  ).has(page)
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
            eligibleKeys.size > 0
              ? {
                  eligible: eligibleKeys,
                  selected: selectedKeys,
                  onToggle: toggleSelected,
                }
              : undefined
          }
        />
      ) : null}

      {eligibleKeys.size > 0 ? (
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
            <Button
              size="sm"
              disabled={selectedCrops.length === 0}
              onClick={() => setSendConfirmOpen(true)}
            >
              <Send data-icon="inline-start" />
              Çıxarılmaya göndər ({selectedCrops.length})
            </Button>
          </div>
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
                : 'Bazaya yalnız göndərdiyin suallar yazılır — qalan crop-lar səhifəni tərk etdikdə silinəcək (yenidən emal ilə bərpa olunur).'}
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
              {selectedCrops.length} sual çıxarılmaya göndərilsin?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Seçilən crop-lar bazaya yazılacaq və AI hər sualı təmiz formada
              yenidən yaradacaq (mətn, variantlar, fiqurlar). Təxmini xərc: ≈ $
              {costLow.toFixed(2)}–${costHigh.toFixed(2)}
              {laneCounts.colored > 0 || laneCounts.rule > 0
                ? ` (mətn: ${laneCounts.none}, sxem: ${laneCounts.rule}, rəngli fiqur: ${laneCounts.colored}; şəkilli variantlar xərci artıra bilər)`
                : ''}
              .{' '}
              {laneCounts.rule > 0
                ? 'Sxem fiquru DSL ilə çəkilə bilməsə, şəkil generasiyasına keçir — bu halda xərc yuxarı hədə yaxınlaşır. '
                : ''}
              Nəticələr Suallar səhifəsində görünür.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>İmtina</AlertDialogCancel>
            <AlertDialogAction onClick={sendToQueue}>Növbəyə at</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {keyDialogOpen && answerKeys.match ? (
        <AnswerKeyDialog
          match={answerKeys.match}
          notes={answerKeys.notes}
          isPending={saveAnswerKeys.isPending}
          onCancel={() => setKeyDialogOpen(false)}
          onConfirm={applyAnswerKeys}
        />
      ) : null}

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

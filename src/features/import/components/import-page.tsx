import { useRef, useState } from 'react'
import { FileUp, Square } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { normalizeError } from '@/lib/errors'
import { parsePageRange } from '@/core/segment/page-range'
import {
  BookFormDialog,
  titleFromFilename,
  useMarkPagesWorked,
} from '@/features/books'
import { BookPicker } from '@/features/import/components/book-picker'
import { CropActions } from '@/features/import/components/crop-actions'
import { CropGrid } from '@/features/import/components/crop-grid'
import {
  DuplicateBookDialog,
  LeaveImportDialog,
  ReplaceRunDialog,
  SendConfirmDialog,
} from '@/features/import/components/import-dialogs'
import { PagePreviewDialog } from '@/features/import/components/page-preview-dialog'
import { PageRangeFields } from '@/features/import/components/page-range-fields'
import { ThumbnailStrip } from '@/features/import/components/thumbnail-strip'
import { useCropQueue } from '@/features/import/hooks/use-crop-queue'
import { useImportAnswerKeys } from '@/features/import/hooks/use-import-answer-keys'
import { useOpenDocument } from '@/features/import/hooks/use-open-document'
import { usePageRanges } from '@/features/import/hooks/use-page-ranges'
import { useSegmentation } from '@/features/import/hooks/use-segmentation'
import { AnswerKeyDialog, BookKeyDialog } from '@/features/questions'
import { usePageTitle } from '@/hooks/use-page-title'

// Composition only. Each concern the page used to carry — getting a document
// open, the two page ranges, the answer key, the crop selection and its send —
// is a hook beside this file, and each dialog is a component. What is left
// here is the one thing that needs all of them: what happens when a new
// document replaces the current one.
export function ImportPage() {
  usePageTitle('İmport')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const reopenInputRef = useRef<HTMLInputElement>(null)
  const [previewPage, setPreviewPage] = useState<number | null>(null)
  // Opening another document mid-run silently kills the run; the operator
  // confirms first, and the confirmed action runs from here.
  const [pendingReplace, setPendingReplace] = useState<(() => void) | null>(
    null,
  )

  const segmentation = useSegmentation()
  const ranges = usePageRanges()
  const document = useOpenDocument(({ initialRange }) => {
    // A new document has none of the previous one's work: not its crops, not
    // its selection, not its key plan, not its ranges.
    segmentation.reset()
    keys.reset()
    queue.reset()
    ranges.reset(initialRange)
    setPreviewPage(null)
  })
  const { doc, currentBook } = document
  const running = segmentation.status === 'running'
  const keys = useImportAnswerKeys({
    doc,
    book: currentBook,
    results: segmentation.results,
    ranges,
  })
  const queue = useCropQueue({
    book: currentBook,
    results: segmentation.results,
    running,
  })
  const markPagesWorked = useMarkPagesWorked()

  function guardReplace(action: () => void) {
    if (running) setPendingReplace(() => action)
    else action()
  }

  const askForFile = () => reopenInputRef.current?.click()

  function startSegmentation() {
    if (!doc || running) return
    const parsed = parsePageRange(ranges.rangeInput, doc.numPages)
    if (!parsed.ok) {
      ranges.setRangeError(parsed.error)
      return
    }
    ranges.setRangeError(null)
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
              if (file) guardReplace(() => void document.handleFile(file))
              e.target.value = ''
            }}
          />
          <input
            ref={reopenInputRef}
            type="file"
            accept="application/pdf"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null
              guardReplace(() => void document.reopenWithFile(file))
              e.target.value = ''
            }}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={document.isChecking}
              onClick={() => fileInputRef.current?.click()}
            >
              <FileUp data-icon="inline-start" />
              PDF yüklə
            </Button>
            <BookPicker
              disabled={document.isDownloading}
              onPick={(book) =>
                guardReplace(() => document.openStoredBook(book, askForFile))
              }
            />
            {document.isDownloading ? (
              <Badge variant="secondary">arxivdən endirilir…</Badge>
            ) : null}
            {document.isChecking ? (
              <Badge variant="secondary">
                <Spinner />
                yoxlanılır…
              </Badge>
            ) : null}
            {document.fileName ? (
              <span className="min-w-0 truncate text-sm">
                {document.fileName}
              </span>
            ) : (
              <span className="text-muted-foreground text-sm">
                Yeni PDF yükləyin və ya arxivdən kitab seçin.
              </span>
            )}
            {document.archiveBadge === 'uploaded' ? (
              <Badge variant="secondary">arxivləndi</Badge>
            ) : null}
            {document.archiveBadge === 'skipped-size' ? (
              <Badge variant="outline">
                arxivlənmədi — 50MB limitindən böyükdür
              </Badge>
            ) : null}
          </div>

          {doc ? (
            <>
              <ThumbnailStrip
                key={document.docSeq}
                doc={doc}
                pageCount={doc.numPages}
                selected={ranges.activePages(doc)}
                onOpen={setPreviewPage}
              />
              <PageRangeFields
                pageCount={doc.numPages}
                ranges={ranges}
                keys={keys}
                running={running}
                hasBook={currentBook !== null}
                onSegment={startSegmentation}
              />
              <PagePreviewDialog
                doc={doc}
                pageCount={doc.numPages}
                page={previewPage}
                isSelected={(page) => ranges.activePages(doc).has(page)}
                onToggleSelected={(page) => ranges.toggleThumb(doc, page)}
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
            value={
              (segmentation.current / Math.max(1, segmentation.total)) * 100
            }
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
            queue.eligibleKeys.size > 0
              ? {
                  eligible: queue.eligibleKeys,
                  selected: queue.selectedKeys,
                  onToggle: queue.toggleSelected,
                }
              : undefined
          }
        />
      ) : null}

      {queue.eligibleKeys.size > 0 ? (
        <CropActions
          eligible={queue.eligibleKeys.size}
          selected={queue.selectedKeys.size}
          sendable={queue.selectedCrops.length}
          onSelectAll={() => queue.setSelectedKeys(new Set(queue.eligibleKeys))}
          onClear={() => queue.setSelectedKeys(new Set())}
          onSend={() => queue.setSendConfirmOpen(true)}
        />
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

      {document.pendingBook ? (
        <BookFormDialog
          open
          title="Yeni kitab"
          description={`${document.pendingBook.file.name} — ${(document.pendingBook.file.size / 1024 / 1024).toFixed(1)} MB${document.pendingBook.pageCount ? `, ${document.pendingBook.pageCount} səhifə` : ''}`}
          submitLabel="Yüklə və aç"
          isPending={document.isCreating}
          defaults={{
            title: titleFromFilename(document.pendingBook.file.name),
            program_id: 0,
            subject_id: null,
            tags: [],
            note: '',
          }}
          onCancel={document.cancelPending}
          onSubmit={document.submitPendingBook}
        />
      ) : null}

      <DuplicateBookDialog
        book={document.duplicate?.book ?? null}
        onOpen={() => document.openDuplicate(askForFile)}
        onClose={document.dismissDuplicate}
      />

      <LeaveImportDialog
        blocker={queue.blocker}
        running={running}
        onLeave={() => {
          segmentation.stop()
          queue.blocker.proceed?.()
        }}
      />

      <SendConfirmDialog
        open={queue.sendConfirmOpen}
        count={queue.selectedCrops.length}
        laneCounts={queue.laneCounts}
        costLow={queue.costLow}
        costHigh={queue.costHigh}
        onCancel={() => queue.setSendConfirmOpen(false)}
        onConfirm={queue.sendToQueue}
      />

      {keys.bookKeyDialogOpen && keys.bookKeys.plan ? (
        <BookKeyDialog
          plan={keys.bookKeys.plan}
          groups={keys.bookKeys.groups}
          notes={keys.bookKeys.notes}
          isPending={keys.isSaving}
          onCancel={() => keys.setBookKeyDialogOpen(false)}
          onConfirm={keys.applyBookKeys}
        />
      ) : null}

      {keys.keyDialogOpen && keys.answerKeys.plan ? (
        <AnswerKeyDialog
          plan={keys.answerKeys.plan}
          questionPages={keys.answerKeys.questionPages}
          keyPages={keys.answerKeys.keyPages}
          fallbackSection={keys.answerKeys.fallbackSection}
          onSection={(section) => {
            if (currentBook)
              void keys.answerKeys.chooseSection(section, currentBook.id)
          }}
          notes={keys.answerKeys.notes}
          isPending={keys.isSaving}
          onCancel={() => keys.setKeyDialogOpen(false)}
          onConfirm={keys.applyAnswerKeys}
        />
      ) : null}

      <ReplaceRunDialog
        open={pendingReplace !== null}
        onCancel={() => setPendingReplace(null)}
        onConfirm={() => {
          const action = pendingReplace
          setPendingReplace(null)
          segmentation.stop()
          action?.()
        }}
      />
    </div>
  )
}

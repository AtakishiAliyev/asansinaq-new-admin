import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { normalizeError } from '@/lib/errors'
import {
  findBookByHash,
  sha256Hex,
  useBackfillPageCount,
  useBooks,
  useCreateBook,
  type Book,
} from '@/features/books'
import { useDownloadPdf } from '@/features/import/api/use-download-pdf'
import { loadPdf, type PDFDocumentProxy } from '@/features/import/lib/pdf'

export interface PendingBook {
  file: File
  hash: string
  pageCount: number | null
}

export interface DuplicateHit {
  book: Book
  file: File
}

export type ArchiveBadge = 'uploaded' | 'skipped-size' | null

type CreateBookForm = Parameters<
  ReturnType<typeof useCreateBook>['mutate']
>[0]['form']

// Getting a PDF in front of the operator, by any of its three routes: a fresh
// upload (hash → duplicate check → metadata dialog → archive), a book from the
// archive, and a book the archive holds no bytes for — over MAX_UPLOAD_BYTES
// the archive keeps the metadata and not the file, so the file has to come
// from disk and is verified against the book's hash before anything opens.
//
// Everything that races lives here: a parse that resolves after the operator
// has picked something else, an unmount mid-load, a `?book=` param that
// arrives before the archive list has. The page sees a document, a book, and
// one callback when a new document has been committed — which is where it
// resets everything it keeps about the previous one.
export function useOpenDocument(
  onOpened: (opts: { initialRange: string }) => void,
) {
  const onOpenedRef = useRef(onOpened)
  onOpenedRef.current = onOpened

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
  /** Picking a book whose PDF was too large to archive asks for the file. */
  const reopenBook = useRef<Book | null>(null)
  const [pendingBook, setPendingBook] = useState<PendingBook | null>(null)
  const [duplicate, setDuplicate] = useState<DuplicateHit | null>(null)
  // Hash + duplicate-check gap after the OS picker closes needs a visible
  // pending state — on a 45MB file it is a multi-second silence otherwise.
  const [isChecking, setIsChecking] = useState(false)
  const [archiveBadge, setArchiveBadge] = useState<ArchiveBadge>(null)
  // The book the open document belongs to — the processing trail hangs off it.
  const [currentBook, setCurrentBook] = useState<Book | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const books = useBooks()
  const createBook = useCreateBook()
  const backfillPageCount = useBackfillPageCount()
  const download = useDownloadPdf()

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
      badge?: ArchiveBadge
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
    setFileName(name)
    setDoc(loaded)
    setDocSeq(seq)
    setArchiveBadge(opts.badge ?? null)
    setCurrentBook(opts.book ?? null)
    onOpenedRef.current({ initialRange: opts.initialRange ?? '' })
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

  function submitPendingBook(form: CreateBookForm) {
    if (!pendingBook) return
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
            // The dialog can be submitted before the parse resolves; fill the
            // page count in once it is known.
            if (book.page_count === null) {
              backfillPageCount.mutate({
                id: book.id,
                pageCount: loaded.numPages,
              })
            }
            commitLoaded(seq, book.title, loaded, { badge: archive, book })
          } catch (error) {
            toast.error(normalizeError(error).message)
          }
        },
      },
    )
  }

  // First page the operator has not touched yet — the "continue from" hint.
  function nextUnworkedPage(book: Book): number | null {
    if (!book.page_count) return null
    const worked = new Set(book.worked_pages)
    for (let p = 1; p <= book.page_count; p++) if (!worked.has(p)) return p
    return null
  }

  const continueFrom = (book: Book): string => {
    const next = nextUnworkedPage(book)
    return next !== null && book.worked_pages.length > 0 ? String(next) : ''
  }

  /** Open an archived book — or, for one with no archived bytes, ask for its
   *  file. The caller owns the file input; `reopenWithFile` takes what it picks. */
  function openStoredBook(book: Book, askForFile: () => void) {
    if (!book.storage_path) {
      reopenBook.current = book
      askForFile()
      return
    }
    const seq = ++loadSeq.current
    void openBuffer(seq, book.title, download.mutateAsync(book.storage_path), {
      book,
      initialRange: continueFrom(book),
    })
  }

  // The file for a book the archive holds no bytes for. Verified by hash: a
  // different PDF opened under this book's name would attach its crops, its
  // worked pages and its answer key to the wrong pages.
  async function reopenWithFile(file: File | null) {
    const book = reopenBook.current
    reopenBook.current = null
    if (!book || !file) return
    setIsChecking(true)
    try {
      const buffer = await file.arrayBuffer()
      if (book.content_hash) {
        const hash = await sha256Hex(buffer)
        if (hash !== book.content_hash) {
          toast.error(
            `Bu fayl «${book.title}» deyil — kitabın öz PDF-ini seçin`,
          )
          return
        }
      }
      const seq = ++loadSeq.current
      await openBuffer(seq, book.title, Promise.resolve(buffer), {
        book,
        initialRange: continueFrom(book),
      })
    } catch (error) {
      toast.error(normalizeError(error).message)
    } finally {
      setIsChecking(false)
    }
  }

  /** The duplicate dialog's "open it anyway": the archived copy if there is
   *  one, otherwise the very file the operator just picked. */
  function openDuplicate(askForFile: () => void) {
    if (!duplicate) return
    if (duplicate.book.storage_path) {
      openStoredBook(duplicate.book, askForFile)
    } else {
      const seq = ++loadSeq.current
      void openBuffer(seq, duplicate.book.title, duplicate.file.arrayBuffer(), {
        book: duplicate.book,
      })
    }
    setDuplicate(null)
  }

  // /import?book=ID — the Kitablar page's "open in import" action. A book with
  // no archived bytes cannot be opened without a file picker, and one cannot
  // be opened from an effect; it is reported rather than silently skipped.
  useEffect(() => {
    const id = Number(searchParams.get('book'))
    if (!id || !books.data) return
    if (handledBook.current === id) return
    handledBook.current = id
    const book = books.data.find((b) => b.id === id)
    setSearchParams({}, { replace: true })
    if (!book) toast.error('Kitab tapılmadı')
    else if (!book.storage_path)
      toast.error(
        'Bu kitabın arxiv faylı yoxdur — arxivdən seçib PDF-i göstərin',
      )
    else openStoredBook(book, () => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires when the list arrives
  }, [books.data, searchParams])

  // The auto-open can't run while the archive list is failing; say so instead
  // of silently ignoring the ?book param (it stays, so a retry resumes it).
  useEffect(() => {
    if (books.isError && searchParams.get('book')) {
      toast.error('Arxiv siyahısı yüklənmədi — kitab avtomatik açıla bilmədi')
    }
  }, [books.isError, searchParams])

  return {
    doc,
    docSeq,
    fileName,
    archiveBadge,
    currentBook,
    pendingBook,
    duplicate,
    isChecking,
    isDownloading: download.isPending,
    isCreating: createBook.isPending,
    handleFile,
    cancelPending,
    submitPendingBook,
    openStoredBook,
    reopenWithFile,
    openDuplicate,
    dismissDuplicate: () => setDuplicate(null),
  }
}

import { useState } from 'react'
import { toast } from 'sonner'
import { normalizeError } from '@/lib/errors'
import { parsePageRange } from '@/core/segment/page-range'
import type { Book } from '@/features/books'
import type { PageResult } from '@/features/import/hooks/use-segmentation'
import type { PageRanges } from '@/features/import/hooks/use-page-ranges'
import type { PDFDocumentProxy } from '@/features/import/lib/pdf'
import {
  useAnswerKeyRun,
  useBookKeyRun,
  useSaveAnswerKeys,
} from '@/features/questions'

/**
 * Why a book-wide read came back with nothing, in the operator's terms.
 *
 * A scan needs two things the pass cannot supply, IN ORDER: the pages that
 * hold the key, and the questions themselves — which on a scan are only known
 * once they have been cropped and sent, because the page numbers come from the
 * bank rather than from a text layer. Reporting "no key found" for either of
 * those sent the operator looking for a defect that was really a missing step.
 */
function scanKeyHint(result: {
  scanned: boolean
  plan: { keyPages: number[]; questionPages: number[] } | null
}): string {
  if (!result.scanned) return 'Kitabda yerləşdirilə bilən cavab açarı tapılmadı'
  if (!result.plan?.keyPages.length) {
    // Deliberately does not promise there IS one. GALATA IQ SORU BANKASI is
    // 496 scanned pages with no printed key anywhere in the file, and a
    // message telling the operator to name its key pages sent them hunting
    // for something the book does not contain.
    return 'Bu kitab skandır — açar səhifələri avtomatik tapıla bilmir. Kitabda çap olunmuş açar varsa (adətən kitabın və ya bölmənin sonunda), səhifə nömrələrini yazın'
  }
  if (!result.plan.questionPages.length) {
    return 'Açar oxundu, amma bu skan kitabda hələ kəsilmiş sual yoxdur — əvvəlcə səhifələri kəsib növbəyə atın, sonra açarı yenidən oxuyun'
  }
  return 'Açar oxundu, amma heç bir bölmə üçün təsdiqlənmədi'
}

// The two ways a printed key reaches the bank from this page. The book-wide
// pass is the default: nothing named, nothing paired by hand. The by-hand
// pairing stays for what the pass cannot settle — a scan, or a section the
// book's shape leaves unproved — and is revealed only then.
export function useImportAnswerKeys(input: {
  doc: PDFDocumentProxy | null
  book: Book | null
  results: PageResult[]
  ranges: PageRanges
}) {
  const { doc, book, results, ranges } = input
  const answerKeys = useAnswerKeyRun()
  const bookKeys = useBookKeyRun()
  const saveAnswerKeys = useSaveAnswerKeys()
  const [keyDialogOpen, setKeyDialogOpen] = useState(false)
  const [bookKeyDialogOpen, setBookKeyDialogOpen] = useState(false)
  /** The by-hand key path, shown only where the book-wide pass cannot serve. */
  const [manualKeyOpen, setManualKeyOpen] = useState(false)

  // The key run needs BOTH ranges: the pages it reads, and the pages those
  // answers belong to. The pairing is the operator's own statement and it
  // replaces every attempt to infer which section a key answers — see
  // `core/answer-key/batch.ts` for the books that made inference untenable.
  function startAnswerKeys() {
    if (!doc || !book) return
    const parsedKeys = parsePageRange(ranges.keyRangeInput, doc.numPages)
    if (!parsedKeys.ok) {
      ranges.setKeyRangeError(parsedKeys.error)
      return
    }
    const parsedQuestions = parsePageRange(ranges.rangeInput, doc.numPages)
    if (!parsedQuestions.ok) {
      ranges.setKeyRangeError(
        'Əvvəlcə sual səhifələrini yazın — açar məhz onlara aid olacaq',
      )
      return
    }
    ranges.setKeyRangeError(null)
    // What the question pages say about themselves, from the segmentation
    // still in memory — the crops are usually not sent yet, so the bank cannot
    // answer this. It is what lets the block be worked out instead of asked.
    const onPages = results.filter((r) =>
      parsedQuestions.pages.includes(r.pageNumber),
    )
    const pageTests = new Map(
      onPages
        .filter(
          (r): r is typeof r & { testNo: number } => r.testNo !== undefined,
        )
        .map((r) => [r.pageNumber, r.testNo] as const),
    )
    const pageNumbers = new Map(
      onPages.map((r) => [r.pageNumber, r.crops.map((c) => c.number)] as const),
    )
    void answerKeys
      .run(
        doc,
        parsedKeys.pages,
        book.id,
        parsedQuestions.pages,
        pageTests,
        pageNumbers,
      )
      .then((result) => {
        if (!result.entries.length) {
          toast.warning('Seçilən səhifələrdə cavab açarı tapılmadı')
          return
        }
        setKeyDialogOpen(true)
      })
      .catch((error) => toast.error(normalizeError(error).message))
  }

  // The whole book at once. Nothing is named and nothing is paired by hand:
  // the pass reads every page and works out which block answers which section
  // from the book's own shape.
  function startBookKey() {
    if (!doc || !book) return
    // Only used if the book turns out to be a scan, where these are the pages
    // that cost a model call.
    const named = parsePageRange(ranges.keyRangeInput, doc.numPages)
    void bookKeys
      .run(doc, book.id, named.ok ? named.pages : [])
      .then((result) => {
        if (!result.groups.length) {
          // A scan has no text layer to read, so the pass needs the operator to
          // name the key pages — the one thing it cannot work out for itself.
          if (result.scanned) setManualKeyOpen(true)
          toast.warning(scanKeyHint(result))
          return
        }
        // Sections the shape could not settle are the other reason to reach for
        // the by-hand path, so it is offered rather than hunted for.
        if (result.plan?.unpaired.length) setManualKeyOpen(true)
        setBookKeyDialogOpen(true)
      })
      .catch((error) => toast.error(normalizeError(error).message))
  }

  function applyBookKeys() {
    if (!book || !bookKeys.plan || !bookKeys.groups.length) return
    saveAnswerKeys.mutate(
      {
        bookId: book.id,
        keyPages: bookKeys.plan.keyPages,
        groups: bookKeys.groups.map((group) => ({
          questionPages: group.questionPages,
          label: group.label,
          entries: group.entries,
          pairs: group.pairs,
        })),
      },
      {
        onSuccess: () => {
          setBookKeyDialogOpen(false)
          bookKeys.reset()
        },
      },
    )
  }

  function applyAnswerKeys() {
    const plan = answerKeys.plan
    if (!book || !plan?.groups.length) return
    // One batch per printed section. A selection spanning three tests writes
    // three, each holding only its own block's answers — storing the whole key
    // page under one pairing would let the worker apply another test's answers
    // to these questions by number.
    saveAnswerKeys.mutate(
      {
        bookId: book.id,
        keyPages: answerKeys.keyPages,
        groups: plan.groups.map((group) => ({
          questionPages: group.pages,
          label: group.section.label,
          entries: group.entries,
          pairs: group.match.pairs.map((p) => ({ id: p.id, answer: p.answer })),
        })),
      },
      {
        onSuccess: () => {
          setKeyDialogOpen(false)
          answerKeys.reset()
        },
      },
    )
  }

  return {
    answerKeys,
    bookKeys,
    isSaving: saveAnswerKeys.isPending,
    keyDialogOpen,
    setKeyDialogOpen,
    bookKeyDialogOpen,
    setBookKeyDialogOpen,
    manualKeyOpen,
    setManualKeyOpen,
    startAnswerKeys,
    startBookKey,
    applyAnswerKeys,
    applyBookKeys,
    /** What a new document must clear: a plan for the previous one. */
    reset: () => answerKeys.reset(),
  }
}

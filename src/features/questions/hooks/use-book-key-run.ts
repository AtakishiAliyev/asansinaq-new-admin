import { useCallback, useState } from 'react'
import { parseAnswerKeyPage, type AnswerKeyEntry } from '@/core/answer-key/parse'
import { readVisionKey } from '@/core/answer-key/vision'
import { planBookKey, type BookKeyPlan, type BookPageRead } from '@/core/answer-key/book'
import { matchBatch } from '@/core/answer-key/batch'
import { pageTextItems, segmentPage } from '@/core/segment/segmenter'
import { opParseAnswerKey } from '@/features/questions/api/question-ops'
import { fetchMatchableQuestions } from '@/features/questions/api/answer-keys'
import { renderPageJpeg, type PDFDocumentProxy } from '@/features/import/lib/pdf'

/** Below this many text items a page has no text layer worth reading. */
const MIN_TEXT_ITEMS = 8

/** One section of the book with the block that answers it, ready to store. */
export interface BookKeyGroup {
  questionPages: number[]
  label: string
  reason: string
  entries: AnswerKeyEntry[]
  /** Questions ALREADY in the bank that this block answers. Usually none: the
   *  whole point is to read the key before the crops are made. */
  pairs: { id: number; answer: string }[]
  /** How many questions the section poses, whether or not they are cropped. */
  questionCount: number
}

export interface BookKeyRunState {
  status: 'idle' | 'running' | 'done'
  /** Pages read so far, for the progress bar. */
  current: number
  total: number
  plan: BookKeyPlan | null
  groups: BookKeyGroup[]
  /** True when the book has no text layer to read — a scan. */
  scanned: boolean
  notes: string[]
}

const IDLE: BookKeyRunState = {
  status: 'idle',
  current: 0,
  total: 0,
  plan: null,
  groups: [],
  scanned: false,
  notes: [],
}

// Reading a book's printed key ONCE, at import, for the whole book.
//
// The operator names nothing and pairs nothing: the pass reads every page, and
// `planBookKey` works out which block answers which section from the book's own
// shape. What comes back is a plan the operator confirms, and what is stored is
// the pairing — so a crop made a week later gets its answer with no further
// step.
//
// Free on a book with a text layer, which is where it runs. A scan has nothing
// to read, so the operator names its key pages and only those pages cost a
// model call — one question per book instead of one per batch of crops.
export function useBookKeyRun() {
  const [state, setState] = useState<BookKeyRunState>(IDLE)

  const run = useCallback(
    async (
      doc: PDFDocumentProxy,
      bookId: number,
      /** Key pages the operator named, for a book with no text layer. */
      scanKeyPages: number[] = [],
    ) => {
      setState({ ...IDLE, status: 'running', total: doc.numPages })
      const reads: BookPageRead[] = []
      const notes: string[] = []
      let withText = 0

      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
        const page = await doc.getPage(pageNumber)
        try {
          const items = await pageTextItems(page)
          if (items.length >= MIN_TEXT_ITEMS) {
            withText++
            const parsed = parseAnswerKeyPage(items)
            const seg = await segmentPage(page)
            reads.push({
              pageNumber,
              numbers: seg.bands.map((b) => b.number),
              ...(seg.testNo !== undefined ? { testNo: seg.testNo } : {}),
              entries: parsed.entries,
            })
          } else if (scanKeyPages.includes(pageNumber)) {
            // The only paid step, and only for pages the operator named.
            const { base64, mime } = await renderPageJpeg(page)
            const result = await opParseAnswerKey({ image: base64, mime })
            const checked = readVisionKey(result.entries)
            reads.push({ pageNumber, numbers: [], entries: checked.entries })
            notes.push(`s.${pageNumber}: skan səhifə — AI ilə oxundu`)
            notes.push(...checked.notes.map((n) => `s.${pageNumber}: ${n}`))
          }
        } catch (error) {
          notes.push(
            `s.${pageNumber}: oxunmadı — ${error instanceof Error ? error.message : 'naməlum xəta'}`,
          )
        } finally {
          page.cleanup()
        }
        setState((current) => ({ ...current, current: pageNumber }))
      }

      // A scanned book prints its question numbers where nothing can read them,
      // so the sections come from what has already been cropped instead.
      const questions = await fetchMatchableQuestions(bookId)
      const scanned = withText < doc.numPages / 2
      if (scanned) {
        const known = new Set(reads.map((r) => r.pageNumber))
        const byPage = new Map<number, number[]>()
        for (const q of questions) {
          if (known.has(q.pageNumber)) continue
          byPage.set(q.pageNumber, [...(byPage.get(q.pageNumber) ?? []), q.qNo])
        }
        for (const [pageNumber, numbers] of byPage) {
          reads.push({ pageNumber, numbers, entries: [] })
        }
      }

      const plan = planBookKey(reads)
      const groups: BookKeyGroup[] = plan.pairings.map((pairing) => ({
        questionPages: pairing.section.pages,
        label: pairing.block.label,
        reason: pairing.reason,
        entries: pairing.block.entries,
        pairs: matchBatch(
          { questionPages: pairing.section.pages, entries: pairing.block.entries },
          questions,
        ).pairs.map((p) => ({ id: p.id, answer: p.answer })),
        questionCount: pairing.section.numbers.length,
      }))

      const done: BookKeyRunState = {
        status: 'done',
        current: doc.numPages,
        total: doc.numPages,
        plan,
        groups,
        scanned,
        notes: [...notes, ...plan.notes],
      }
      setState(done)
      return done
    },
    [],
  )

  const reset = useCallback(() => setState(IDLE), [])

  return { ...state, run, reset }
}

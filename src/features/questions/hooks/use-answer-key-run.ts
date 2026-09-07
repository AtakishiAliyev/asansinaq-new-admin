import { useCallback, useState } from 'react'
import { parseAnswerKeyPage, type AnswerKeyEntry } from '@/core/answer-key/parse'
import {
  answeredBySection,
  matchBatch,
  suggestSection,
  type BatchMatch,
} from '@/core/answer-key/batch'
import { readVisionKey } from '@/core/answer-key/vision'
import { pageTextItems } from '@/core/segment/segmenter'
import { opParseAnswerKey } from '@/features/questions/api/question-ops'
import { fetchMatchableQuestions } from '@/features/questions/api/answer-keys'
import { renderPageJpeg, type PDFDocumentProxy } from '@/features/import/lib/pdf'

/** Below this many text items a page is a scan — the vision op reads it. */
const MIN_TEXT_ITEMS = 8

export interface AnswerKeyRunState {
  status: 'idle' | 'running' | 'done'
  current: number
  total: number
  /** Every answer read from the key pages, whatever section they announced. */
  entries: AnswerKeyEntry[]
  /** What the key pages called themselves, for the record. Never matched on. */
  labels: string[]
  /** The pages the operator paired: the questions, then the key. */
  questionPages: number[]
  keyPages: number[]
  match: BatchMatch | null
  /** The block in use — worked out from the book where it can be. */
  section: string | undefined
  /** Why that block was chosen, when it was chosen for the operator. */
  sectionReason: string | null
  notes: string[]
}

const IDLE: AnswerKeyRunState = {
  status: 'idle',
  current: 0,
  total: 0,
  entries: [],
  labels: [],
  questionPages: [],
  keyPages: [],
  match: null,
  section: undefined,
  sectionReason: null,
  notes: [],
}

// Reading the printed key: text-layer pages parse deterministically and for
// free, scanned ones cost one vision call. Nothing is written here — the run
// ends in a preview the operator confirms.
//
// The key is placed by the PAGES the operator paired it with, not by the
// section it announces. A survey of nine books is why: one prints `Test-1`
// twice for two subjects, one heads its sections in a form no pattern reads,
// and five are scans with no header to read. The printed labels are kept as a
// record and matched on by nothing.
export function useAnswerKeyRun() {
  const [state, setState] = useState<AnswerKeyRunState>(IDLE)

  const run = useCallback(
    async (
      doc: PDFDocumentProxy,
      keyPages: number[],
      bookId: number,
      /** The crop pages these key pages answer — the operator's own pairing. */
      questionPages: number[],
      /**
       * What those pages say about themselves: the test numbers printed in
       * their headers, and the question numbers on them. Read from the
       * segmentation still in memory when the crops have not been sent yet,
       * which is the usual case — see `suggestSection`.
       */
      evidence: { questionTests: number[]; questionNumbers: number[] } = {
        questionTests: [],
        questionNumbers: [],
      },
    ) => {
      const pages = keyPages
      setState({ ...IDLE, status: 'running', total: pages.length, questionPages, keyPages })
      const entries: AnswerKeyEntry[] = []
      const labels: string[] = []
      const notes: string[] = []

      for (const [index, pageNumber] of pages.entries()) {
        const page = await doc.getPage(pageNumber)
        try {
          const items = await pageTextItems(page)
          let pageEntries: AnswerKeyEntry[] = []

          if (items.length >= MIN_TEXT_ITEMS) {
            const parsed = parseAnswerKeyPage(items)
            pageEntries = parsed.entries
            notes.push(...parsed.notes.map((n) => `s.${pageNumber}: ${n}`))
          } else {
            const { base64, mime } = await renderPageJpeg(page)
            const result = await opParseAnswerKey({ image: base64, mime })
            // Held to the same rules the text path applies to itself: a model
            // read is the one input here that can invent, so it is the last
            // one that should go in unchecked.
            const checked = readVisionKey(result.entries)
            pageEntries = checked.entries
            notes.push(`s.${pageNumber}: skan səhifə — AI ilə oxundu`)
            notes.push(...checked.notes.map((n) => `s.${pageNumber}: ${n}`))
          }

          for (const entry of pageEntries) {
            if (entry.testNo !== undefined) labels.push(`Test ${entry.testNo}`)
          }
          // A block id is unique within its page's parse; the page makes it
          // unique across the run, or two pages' first blocks would merge.
          entries.push(
            ...pageEntries.map((e) => ({
              ...e,
              ...(e.sectionId !== undefined
                ? { sectionId: `${pageNumber}-${e.sectionId}` }
                : {}),
            })),
          )
        } catch (error) {
          notes.push(
            `s.${pageNumber}: oxunmadı — ${error instanceof Error ? error.message : 'naməlum xəta'}`,
          )
        } finally {
          page.cleanup()
        }
        setState((current) => ({ ...current, current: index + 1 }))
      }

      const questions = await fetchMatchableQuestions(bookId)
      const first = matchBatch({ questionPages, entries }, questions)
      // The book usually answers this itself: its question pages print the
      // test they belong to. Only what cannot be worked out is asked.
      const onPages = questions.filter((q) => questionPages.includes(q.pageNumber))
      const suggestion = suggestSection(first.sections, {
        questionTests: evidence.questionTests.length
          ? evidence.questionTests
          : [...new Set(onPages.map((q) => q.testNo).filter((t): t is number => t !== null))],
        questionNumbers: evidence.questionNumbers.length
          ? evidence.questionNumbers
          : onPages.map((q) => q.qNo),
        answeredBy: answeredBySection(entries),
      })
      const section = suggestion?.section.id
      const match =
        section === undefined ? first : matchBatch({ questionPages, entries, section }, questions)
      const done: AnswerKeyRunState = {
        status: 'done',
        current: pages.length,
        total: pages.length,
        entries,
        labels: [...new Set(labels)],
        questionPages,
        keyPages,
        match,
        section,
        sectionReason: suggestion?.reason ?? null,
        notes,
      }
      // The whole point of the preview: a number the key answers that no
      // question carries, or a number printed twice across the paired pages,
      // is something only the operator can settle.
      setState(done)
      return done
    },
    [],
  )

  const reset = useCallback(() => setState(IDLE), [])

  /** Re-match against one printed section, when the key pages held several. */
  const chooseSection = useCallback(
    async (section: string | undefined, bookId: number) => {
      const questions = await fetchMatchableQuestions(bookId)
      setState((current) => ({
        ...current,
        section,
        // An operator override stops being the book's reasoning.
        sectionReason: null,
        match: matchBatch(
          {
            questionPages: current.questionPages,
            entries: current.entries,
            ...(section === undefined ? {} : { section }),
          },
          questions,
        ),
      }))
    },
    [],
  )

  return { ...state, run, reset, chooseSection }
}

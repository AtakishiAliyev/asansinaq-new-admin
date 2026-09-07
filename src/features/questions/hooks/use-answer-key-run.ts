import { useCallback, useState } from 'react'
import { parseAnswerKeyPage, type AnswerKeyEntry } from '@/core/answer-key/parse'
import { matchBatch, type BatchMatch } from '@/core/answer-key/batch'
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
  /** The block the operator picked, when the key pages held several. */
  section: string | undefined
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
      // A key page that printed exactly one section needs no choice; several
      // and the operator makes one, because nothing else can.
      const first = matchBatch({ questionPages, entries }, questions)
      const section = first.sections.length === 1 ? first.sections[0]!.id : undefined
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

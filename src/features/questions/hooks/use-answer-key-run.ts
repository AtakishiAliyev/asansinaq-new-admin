import { useCallback, useState } from 'react'
import { parseAnswerKeyPage, type AnswerKeyEntry } from '@/core/answer-key/parse'
import {
  matchAnswerKeys,
  type KeyBlock,
  type MatchableQuestion,
  type MatchResult,
} from '@/core/answer-key/match'
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
  blocks: KeyBlock[]
  match: MatchResult | null
  /** the book's questions as matched against — an override re-uses them */
  questions: MatchableQuestion[]
  notes: string[]
}

const IDLE: AnswerKeyRunState = {
  status: 'idle',
  current: 0,
  total: 0,
  blocks: [],
  match: null,
  questions: [],
  notes: [],
}

// Reading the printed key: text-layer pages parse deterministically and for
// free, scanned ones cost one vision call. Nothing is written here — the run
// ends in a preview the operator confirms.
export function useAnswerKeyRun() {
  const [state, setState] = useState<AnswerKeyRunState>(IDLE)

  const run = useCallback(
    async (doc: PDFDocumentProxy, pages: number[], bookId: number) => {
      setState({ ...IDLE, status: 'running', total: pages.length })
      const blocks: KeyBlock[] = []
      const notes: string[] = []

      for (const [index, pageNumber] of pages.entries()) {
        const page = await doc.getPage(pageNumber)
        try {
          const items = await pageTextItems(page)
          let entries: AnswerKeyEntry[] = []
          let testNo: number | undefined

          if (items.length >= MIN_TEXT_ITEMS) {
            const parsed = parseAnswerKeyPage(items)
            entries = parsed.entries
            testNo = parsed.entries[0]?.testNo
            notes.push(...parsed.notes.map((n) => `s.${pageNumber}: ${n}`))
          } else {
            const { base64, mime } = await renderPageJpeg(page)
            const result = await opParseAnswerKey({ image: base64, mime })
            entries = result.entries.map((e) => ({
              qNo: e.q_no,
              answer: e.answer,
              ...(e.test_no != null ? { testNo: e.test_no } : {}),
            }))
            testNo = entries[0]?.testNo
            notes.push(`s.${pageNumber}: skan səhifə — AI ilə oxundu`)
          }

          if (entries.length) {
            blocks.push({
              ...(testNo !== undefined ? { testNo } : {}),
              sourcePage: pageNumber,
              entries,
            })
          }
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
      const match = matchAnswerKeys(blocks, questions)
      // The whole point of the preview: an unmatched block means the operator
      // must place it, or structure that section's questions first.
      setState({
        status: 'done',
        current: pages.length,
        total: pages.length,
        blocks,
        match,
        questions,
        notes,
      })
      return { blocks, match, questions, notes }
    },
    [],
  )

  const reset = useCallback(() => setState(IDLE), [])

  return { ...state, run, reset }
}

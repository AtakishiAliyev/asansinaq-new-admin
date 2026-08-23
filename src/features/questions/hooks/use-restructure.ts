import { useCallback, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Crop } from '@/core/segment/types'
import type { ExtractedQuestion } from '@/core/questions/extraction'
import { wireToQuestion } from '@/core/questions/extraction'
import { buildRowPayload } from '@/core/questions/row-payload'
import type { Flag } from '@/core/questions/lint'
import { PROMPT_VERSION } from '@/core/extract/prompts'
import { opExtract, OpError } from '@/features/questions/api/question-ops'
import { fetchBookAnswerKeys } from '@/features/questions/api/answer-keys'
import { fetchBookCategories } from '@/features/questions/api/book-categories'
import type { CategoryOption } from '@/features/questions/api/book-categories'
import { toCropEntries } from '@/features/questions/lib/crop-entry'
import { cropRegion, splitDataUrl } from '@/features/questions/lib/image'
import type { QuestionRow } from '@/features/questions/schemas'

// Re-running ONE question, on demand, from the review screen.
//
// This is the only orchestration left in the browser, and it is deliberately
// the same shape as the worker's: one structured call, the crop sent once, the
// answer written through the same core payload builder. It is not a second
// pipeline — a re-run that produced a different row than the batch would make
// the review screen a place where questions quietly changed meaning.
//
// What it is NOT is the queue. Draining thousands of questions belongs to
// `worker/`, where a batch costs half as much and is not bounded by an Edge
// Function's wall clock. Nothing here should grow a loop over a book.

export interface StructuringItem {
  row: QuestionRow
  crop: Crop
  question?: ExtractedQuestion
  flags: Flag[]
  verified: boolean
  status: 'structured' | 'failed'
  error?: string
}

interface RunState {
  status: 'idle' | 'running' | 'done'
  current: number
  total: number
  items: StructuringItem[]
}

const IDLE: RunState = { status: 'idle', current: 0, total: 0, items: [] }

interface BookContext {
  answerKeys: Map<string, string>
  answerKeysRead: boolean
  categories: CategoryOption[]
}

/** Cut a picture option out of the crop and store it. Deterministic and free —
 *  the same step the worker does, with the browser's canvas instead of Node's. */
async function attachOptionImages(
  row: QuestionRow,
  crop: Crop,
  question: ExtractedQuestion,
): Promise<number> {
  const wanted = question.options.filter((o) => o.isImage && o.box && !o.image)
  let produced = 0
  for (const option of wanted) {
    try {
      const dataUrl = await cropRegion(crop.dataUrl, option.box!)
      const { image, mime } = splitDataUrl(dataUrl)
      const bytes = Uint8Array.from(atob(image), (c) => c.charCodeAt(0))
      const path = `${row.book_id}/p${row.page_number}_c${row.col}_q${row.q_no}_opt${option.label}.png`
      const { error } = await supabase.storage
        .from('question-crops')
        .upload(path, new Blob([bytes], { type: mime }), {
          upsert: true,
          contentType: mime,
        })
      if (error) throw new Error(error.message)
      option.image = path
      produced++
    } catch {
      // Left without an image on purpose: lint then reports the option as
      // empty, which is true, rather than the row carrying a broken path.
    }
  }
  return produced
}

export function useRestructure() {
  const [state, setState] = useState<RunState>(IDLE)
  const runId = useRef(0)

  const stop = useCallback(() => {
    runId.current += 1
    setState((s) => (s.status === 'running' ? { ...s, status: 'done' } : s))
  }, [])

  const run = useCallback(async (rows: QuestionRow[]) => {
    const id = ++runId.current
    const entries = await toCropEntries(rows)
    if (!entries.length) throw new Error('crop faylları açıla bilmədi')

    setState({ status: 'running', current: 0, total: entries.length, items: [] })

    // Resolved per book, never once per run: a selection can span books, and a
    // tree from the wrong subject produces a category id that exists and is
    // wrong — the one mistake nothing downstream catches.
    const context = new Map<number, BookContext>()
    const contextFor = async (bookId: number): Promise<BookContext> => {
      const hit = context.get(bookId)
      if (hit) return hit
      const [keys, categories] = await Promise.all([
        fetchBookAnswerKeys(bookId)
          .then((answerKeys) => ({ answerKeys, answerKeysRead: true }))
          .catch(() => ({
            answerKeys: new Map<string, string>(),
            answerKeysRead: false,
          })),
        fetchBookCategories(bookId).catch(() => [] as CategoryOption[]),
      ])
      const resolved = { ...keys, categories }
      context.set(bookId, resolved)
      return resolved
    }

    const items: StructuringItem[] = []
    for (const entry of entries) {
      if (runId.current !== id) break
      const { row, crop } = entry
      try {
        const book = await contextFor(row.book_id)
        const { image, mime } = splitDataUrl(crop.dataUrl)
        const { wire, model } = await opExtract({
          image,
          mime,
          hasFigure: row.figure_kind !== 'none',
          textLayerHint: crop.textLayer || undefined,
          testNo: row.test_no ?? undefined,
          expectedNumber: crop.number,
          categories: book.categories,
        })

        const question = wireToQuestion(wire)
        const cropped = await attachOptionImages(row, crop, question)
        const payload = buildRowPayload(question, wire, {
          qNo: crop.number,
          currentStatus: row.status,
          answerSource: row.answer_source ?? null,
          keyAnswer:
            book.answerKeys.get(`${row.test_no ?? 0}:${row.q_no}`) ??
            book.answerKeys.get(`0:${row.q_no}`) ??
            null,
          answerKeysRead: book.answerKeysRead,
          categoryIds: book.categories.map((c) => c.id),
          croppedOptionImages: cropped,
          model,
          promptVersion: PROMPT_VERSION,
        })

        const { error } = await supabase
          .from('questions')
          .update(payload.update as never)
          .eq('id', row.id)
        if (error) throw new Error(error.message)

        items.push({
          row,
          crop,
          question,
          flags: payload.flags,
          verified: false,
          status: payload.status,
        })
      } catch (error) {
        // The budget refusal is a stop, not a per-question failure: continuing
        // would produce a row of identical failures and no work.
        if (error instanceof OpError && error.kind === 'budget') {
          setState((s) => ({ ...s, status: 'done', items }))
          throw error
        }
        items.push({
          row,
          crop,
          flags: [],
          verified: false,
          status: 'failed',
          error: error instanceof Error ? error.message : 'yenidən çıxarıla bilmədi',
        })
      }
      setState((s) => ({ ...s, current: items.length, items: [...items] }))
    }

    setState((s) => ({ ...s, status: 'done', items }))
    return items
  }, [])

  return { ...state, run, stop }
}

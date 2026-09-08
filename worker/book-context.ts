// What the worker has to know about a book before it can file its questions:
// the printed answer key, and the category tree they may be filed under.
//
// Resolved per book and cached for the run. A batch drains one book at a time,
// but a claim can fall back to any book, so this is keyed rather than passed in
// once — a tree from the wrong subject makes the model pick an id that exists
// and is wrong, which is the one kind of mistake nothing downstream catches.
import { batchAnswerIndex, batchAnswerKey } from '@/core/answer-key/batch'
import type { CategoryOption } from '@/core/extract/request-anthropic'
import type { Db } from './db.ts'

export interface BookContext {
  /**
   * `${page_number}:${q_no}` → answer, from the operator's own pairing of key
   * pages to question pages.
   *
   * The one lookup that needs no inference: a question's page and printed
   * number are both facts. A map keyed by test number used to sit beside it
   * for books imported before the pairing existed; it had been reading an
   * empty table for as long as the pairing had, and is gone.
   */
  batchAnswers: Map<string, string>
  /**
   * False when the KEY FETCH ITSELF failed. "No key imported" and "we could not
   * read the key" are different facts and only one of them is the book's — a
   * question left answerless by a network error must say so.
   */
  answerKeysRead: boolean
  categories: CategoryOption[]
  /**
   * Which figure lane this book is on.
   *
   * Here rather than looked up where it is used, because two stages need the
   * same answer about the same book and they must not be able to disagree:
   * extraction decides whether a figure may be a DSL kind at all, and the
   * cutting stage decides whether to reproduce it.
   */
  figureLane: 'cut' | 'gen'
}

const PAGE = 1000

async function fetchBatchAnswers(db: Db, bookId: number): Promise<Map<string, string>> {
  const { data: batches, error } = await db
    .from('answer_key_batches')
    .select('id, question_pages')
    .eq('book_id', bookId)
    // A later batch corrects an earlier one, so it has to be applied last.
    .order('id')
  if (error) throw new Error(error.message)
  if (!batches?.length) return new Map()

  const ids = batches.map((b) => b.id)
  const entries: { batch_id: number; q_no: number; answer: string }[] = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error: entryError } = await db
      .from('answer_key_entries')
      .select('batch_id, q_no, answer')
      .in('batch_id', ids)
      .order('batch_id')
      .order('q_no')
      .range(offset, offset + PAGE - 1)
    if (entryError) throw new Error(entryError.message)
    const rows = data ?? []
    entries.push(...rows)
    if (rows.length < PAGE) break
  }

  const byBatch = new Map<number, { qNo: number; answer: string }[]>()
  for (const e of entries) {
    byBatch.set(e.batch_id, [...(byBatch.get(e.batch_id) ?? []), { qNo: e.q_no, answer: e.answer }])
  }
  return batchAnswerIndex(
    batches.map((b) => ({
      questionPages: b.question_pages ?? [],
      entries: byBatch.get(b.id) ?? [],
    })),
  )
}

async function fetchCategories(
  db: Db,
  bookId: number,
): Promise<CategoryOption[]> {
  const { data: book, error } = await db
    .from('books')
    .select('subject_id')
    .eq('id', bookId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  const subjectId = book?.subject_id
  if (!subjectId) return []

  const { data, error: catError } = await db
    .from('categories')
    .select('id, name, parent_id')
    .eq('subject_id', subjectId)
    .order('id')
  if (catError) throw new Error(catError.message)
  return (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    parentId: c.parent_id,
  }))
}

const cache = new Map<number, BookContext>()

/**
 * Drop what is cached, so the next pass reads the book afresh.
 *
 * The cache is per PASS, not per process. The worker is a daemon that runs
 * for weeks, and a context held for its lifetime is a context that never sees
 * a change: a book switched from `gen` to `cut` in the UI, a category added,
 * an answer key imported after the queue had started. Each of those kept
 * applying yesterday's answer until someone restarted the daemon, and the log
 * shows exactly that — SIGTERMs clustered right after live runs. Within a pass
 * the cache still saves fifty lookups of the same three rows.
 */
export function forgetBookContexts(): void {
  cache.clear()
}

export async function bookContext(db: Db, bookId: number): Promise<BookContext> {
  const hit = cache.get(bookId)
  if (hit) return hit

  let batchAnswers = new Map<string, string>()
  let answerKeysRead = true
  try {
    batchAnswers = await fetchBatchAnswers(db, bookId)
  } catch (error) {
    answerKeysRead = false
    console.warn(
      `[book ${bookId}] answer key unreadable: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  const { data: book } = await db
    .from('books')
    .select('figure_render')
    .eq('id', bookId)
    .maybeSingle()

  const context: BookContext = {
    batchAnswers,
    answerKeysRead,
    categories: await fetchCategories(db, bookId),
    // Unknown or unreadable means 'cut', the lane that cannot be wrong about
    // the page.
    figureLane: book?.figure_render === 'gen' ? 'gen' : 'cut',
  }
  // Only a successful key read is worth keeping: a transient failure must not
  // stamp "this book has no answers" on the rest of the run.
  if (answerKeysRead) cache.set(bookId, context)
  return context
}

/**
 * The answer for one question, or null. Never a model's opinion.
 *
 * Resolved by page and printed number, which are facts. A lookup by test
 * number used to follow as a fallback; it rested on a section that had to be
 * inferred, a survey of nine books showed the inference cannot be made, and
 * its table had held nothing for as long as the pairing existed.
 */
export function answerFor(
  context: BookContext,
  qNo: number,
  pageNumber?: number,
): string | null {
  if (pageNumber === undefined) return null
  return context.batchAnswers.get(batchAnswerKey(pageNumber, qNo)) ?? null
}

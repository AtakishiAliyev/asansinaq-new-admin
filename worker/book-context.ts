// What the worker has to know about a book before it can file its questions:
// the printed answer key, and the category tree they may be filed under.
//
// Resolved per book and cached for the run. A batch drains one book at a time,
// but a claim can fall back to any book, so this is keyed rather than passed in
// once — a tree from the wrong subject makes the model pick an id that exists
// and is wrong, which is the one kind of mistake nothing downstream catches.
import type { CategoryOption } from '@/core/extract/request-anthropic'
import type { Db } from './db.ts'

export interface BookContext {
  /** `${test_no}:${q_no}` → answer. Empty when the book has no key imported. */
  answerKeys: Map<string, string>
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

async function fetchAnswerKeys(
  db: Db,
  bookId: number,
): Promise<Map<string, string>> {
  const keys = new Map<string, string>()
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db
      .from('answer_keys')
      .select('test_no, q_no, answer')
      .eq('book_id', bookId)
      .range(offset, offset + PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = data ?? []
    for (const row of rows) {
      if (row.answer) keys.set(`${row.test_no ?? 0}:${row.q_no}`, row.answer)
    }
    // A truncated read would silently shrink the key and leave real answers
    // looking absent, so page until the server returns a short batch.
    if (rows.length < PAGE) break
  }
  return keys
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

export async function bookContext(db: Db, bookId: number): Promise<BookContext> {
  const hit = cache.get(bookId)
  if (hit) return hit

  let answerKeys = new Map<string, string>()
  let answerKeysRead = true
  try {
    answerKeys = await fetchAnswerKeys(db, bookId)
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
    answerKeys,
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

/** The answer for one question, or null. Never a model's opinion. */
export function answerFor(
  context: BookContext,
  testNo: number | null,
  qNo: number,
): string | null {
  return (
    context.answerKeys.get(`${testNo ?? 0}:${qNo}`) ??
    context.answerKeys.get(`0:${qNo}`) ??
    null
  )
}

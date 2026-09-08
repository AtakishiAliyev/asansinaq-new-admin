import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { normalizeError } from '@/lib/errors'
import type { AnswerKeyEntry } from '@/core/answer-key/parse'
import type { MatchableQuestion } from '@/core/answer-key/batch'
import { questionKeys } from '@/features/questions/api/keys'

/** Everything the matcher needs about a book's saved questions. */
export async function fetchMatchableQuestions(
  bookId: number,
): Promise<MatchableQuestion[]> {
  const all: MatchableQuestion[] = []
  const PAGE = 1000
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from('questions')
      .select('id, page_number, col, q_no, test_no')
      .eq('book_id', bookId)
      .order('page_number')
      .order('col')
      .order('q_no')
      .range(offset, offset + PAGE - 1)
    if (error) throw error
    const rows = data ?? []
    all.push(
      ...rows.map((r) => ({
        id: r.id,
        pageNumber: r.page_number,
        col: r.col,
        qNo: r.q_no,
        testNo: r.test_no,
      })),
    )
    // A truncated read would silently shrink the matching pool, so page until
    // the server returns a short batch.
    if (rows.length < PAGE) break
  }
  return all
}

/** One printed section's worth: the pages it covers and the block that
 *  answers them. A ten-page selection spanning three tests writes three. */
export interface AnswerKeyBatchGroup {
  questionPages: number[]
  label?: string
  entries: AnswerKeyEntry[]
  pairs: { id: number; answer: string }[]
}

export interface SaveAnswerKeyBatchInput {
  bookId: number
  /** Where the key was read from. The same pages back every group. */
  keyPages: number[]
  groups: AnswerKeyBatchGroup[]
}

// Two writes, in this order: the pairing is archived first — so it can be
// applied to questions cropped later — then it is stamped onto the questions
// that exist now. The archive is what makes the operator's statement durable;
// without it a key read before its crops would have to be read again.
/** PostgREST takes a large array happily; this keeps one request bounded. */
const WRITE_CHUNK = 1000

/** Two groups of a plan never cover the same pages, so the pages name the row. */
const pagesKey = (pages: number[]) => [...pages].sort((a, b) => a - b).join(',')

/**
 * Pairings this write is about to replace.
 *
 * A pairing for a set of pages is a STATEMENT about those pages, not an
 * addition to a pile: reading a book's key again — after a parser fix, or just
 * to check it — must leave one answer per question, not two of them with the
 * later read winning by accident. Only the pages being rewritten are cleared,
 * so an unrelated pairing made by hand survives.
 */
async function staleBatchIds(bookId: number, pages: Set<string>): Promise<number[]> {
  const ids: number[] = []
  const PAGE = 1000
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from('answer_key_batches')
      .select('id, question_pages')
      .eq('book_id', bookId)
      .order('id')
      .range(offset, offset + PAGE - 1)
    if (error) throw error
    const rows = data ?? []
    for (const row of rows) {
      if (pages.has(pagesKey(row.question_pages))) ids.push(row.id)
    }
    if (rows.length < PAGE) break
  }
  return ids
}

async function saveAnswerKeyBatch(input: SaveAnswerKeyBatchInput) {
  const { data: userData } = await supabase.auth.getUser()
  if (!input.groups.length) return { archived: 0, applied: 0 }

  // Entries cascade with their batch, so this clears both.
  const stale = await staleBatchIds(
    input.bookId,
    new Set(input.groups.map((g) => pagesKey(g.questionPages))),
  )
  if (stale.length) {
    const { error } = await supabase.from('answer_key_batches').delete().in('id', stale)
    if (error) throw error
  }

  // One insert for every group, not one per group: reading a book's key in a
  // single pass produces a batch per printed section, and Soru Bankası 2025 A
  // has 133 of them. A round trip each would have made confirming a plan a
  // minute of sequential inserts.
  const { data: rows, error: batchError } = await supabase
    .from('answer_key_batches')
    .insert(
      input.groups.map((group) => ({
        book_id: input.bookId,
        question_pages: group.questionPages,
        key_pages: input.keyPages,
        label: group.label ?? null,
        created_by: userData.user?.id ?? null,
      })),
    )
    .select('id, question_pages')
  if (batchError) throw batchError

  const ids = new Map((rows ?? []).map((r) => [pagesKey(r.question_pages), r.id]))
  const entries: { batch_id: number; q_no: number; answer: string }[] = []
  for (const group of input.groups) {
    const id = ids.get(pagesKey(group.questionPages))
    // Writing entries under the wrong batch would attach a section's answers
    // to another section's pages, so a row that cannot be identified stops the
    // write rather than guessing which batch it belongs to.
    if (id === undefined) {
      throw new Error(`s.${group.questionPages.join(',')} üçün paket qeydi tapılmadı`)
    }
    for (const entry of group.entries) {
      entries.push({ batch_id: id, q_no: entry.qNo, answer: entry.answer })
    }
  }

  for (let i = 0; i < entries.length; i += WRITE_CHUNK) {
    const { error } = await supabase
      .from('answer_key_entries')
      .upsert(entries.slice(i, i + WRITE_CHUNK), { onConflict: 'batch_id,q_no' })
    if (error) throw error
  }

  // One call for every group: the RPC is atomic and a second round trip per
  // group would only widen the window in which half the answers are written.
  const pairs = input.groups.flatMap((g) => g.pairs)
  let applied = 0
  if (pairs.length) {
    const { data, error } = await supabase.rpc('apply_answer_keys', { p_pairs: pairs })
    if (error) throw error
    applied = Number(data ?? 0)
  }
  return { archived: entries.length, applied }
}

export function useSaveAnswerKeys() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: saveAnswerKeyBatch,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: questionKeys.all })
      toast.success(
        `${result.archived} cavab saxlanıldı, ${result.applied} suala yazıldı`,
      )
    },
    onError: (error) =>
      toast.error(`Cavab açarı tətbiq olunmadı: ${normalizeError(error).message}`),
  })
}

/**
 * The printed answers for a book, keyed `test:q_no`, used during structuring.
 * Paged for the same reason the matcher is: a book with twenty tests passes
 * PostgREST's 1000-row ceiling, and a truncated read would leave the tail of
 * the book answerless while looking exactly like a book with no key.
 */
export async function fetchBookAnswerKeys(
  bookId: number,
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const PAGE = 1000
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from('answer_keys')
      .select('test_no, q_no, answer')
      .eq('book_id', bookId)
      .order('test_no')
      .order('q_no')
      .range(offset, offset + PAGE - 1)
    if (error) throw error
    const rows = data ?? []
    for (const row of rows) map.set(`${row.test_no}:${row.q_no}`, row.answer)
    if (rows.length < PAGE) break
  }
  return map
}

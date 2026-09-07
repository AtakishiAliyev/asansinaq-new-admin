import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { normalizeError } from '@/lib/errors'
import type { AnswerKeyEntry } from '@/core/answer-key/parse'
import type { MatchableQuestion } from '@/core/answer-key/match'
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

export interface SaveAnswerKeyBatchInput {
  bookId: number
  /** The crop pages the operator said this key answers. */
  questionPages: number[]
  /** Where the key was read from. */
  keyPages: number[]
  /** What the key pages called this section, when they said anything. */
  label?: string
  entries: AnswerKeyEntry[]
  /** decided (question id → answer) pairs, already reviewed by the operator */
  pairs: { id: number; answer: string }[]
}

// Two writes, in this order: the pairing is archived first — so it can be
// applied to questions cropped later — then it is stamped onto the questions
// that exist now. The archive is what makes the operator's statement durable;
// without it a key read before its crops would have to be read again.
async function saveAnswerKeyBatch(input: SaveAnswerKeyBatchInput) {
  const { data: userData } = await supabase.auth.getUser()

  const { data: batch, error: batchError } = await supabase
    .from('answer_key_batches')
    .insert({
      book_id: input.bookId,
      question_pages: input.questionPages,
      key_pages: input.keyPages,
      label: input.label ?? null,
      created_by: userData.user?.id ?? null,
    })
    .select('id')
    .single()
  if (batchError) throw batchError

  if (input.entries.length) {
    const { error } = await supabase.from('answer_key_entries').upsert(
      input.entries.map((entry) => ({
        batch_id: batch.id,
        q_no: entry.qNo,
        answer: entry.answer,
      })),
      { onConflict: 'batch_id,q_no' },
    )
    if (error) throw error
  }

  let applied = 0
  if (input.pairs.length) {
    const { data, error } = await supabase.rpc('apply_answer_keys', {
      p_pairs: input.pairs,
    })
    if (error) throw error
    applied = Number(data ?? 0)
  }
  return { archived: input.entries.length, applied }
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

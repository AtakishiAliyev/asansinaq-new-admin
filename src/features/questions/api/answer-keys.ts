import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { normalizeError } from '@/lib/errors'
import type { KeyBlock, MatchableQuestion } from '@/core/answer-key/match'
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

export interface SaveAnswerKeysInput {
  bookId: number
  blocks: KeyBlock[]
  /** decided (question id → answer) pairs, already reviewed by the operator */
  pairs: { id: number; answer: string }[]
}

// Two writes, in this order: the printed key is archived first (so it can be
// re-applied to questions structured later), then it is stamped onto the
// questions that exist now.
async function saveAnswerKeys({ bookId, blocks, pairs }: SaveAnswerKeysInput) {
  const { data: userData } = await supabase.auth.getUser()
  const rows = blocks.flatMap((block) =>
    block.entries.map((entry) => ({
      book_id: bookId,
      test_no: entry.testNo ?? block.testNo ?? 0,
      q_no: entry.qNo,
      answer: entry.answer,
      source_page: block.sourcePage,
      created_by: userData.user?.id ?? null,
    })),
  )
  if (rows.length) {
    const { error } = await supabase
      .from('answer_keys')
      .upsert(rows, { onConflict: 'book_id,test_no,q_no' })
    if (error) throw error
  }

  let applied = 0
  if (pairs.length) {
    const { data, error } = await supabase.rpc('apply_answer_keys', {
      p_pairs: pairs,
    })
    if (error) throw error
    applied = Number(data ?? 0)
  }
  return { archived: rows.length, applied }
}

export function useSaveAnswerKeys() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: saveAnswerKeys,
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

/** The printed answer for one question, used during structuring. */
export async function fetchBookAnswerKeys(
  bookId: number,
): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from('answer_keys')
    .select('test_no, q_no, answer')
    .eq('book_id', bookId)
  if (error) throw error
  const map = new Map<string, string>()
  for (const row of data ?? []) map.set(`${row.test_no}:${row.q_no}`, row.answer)
  return map
}

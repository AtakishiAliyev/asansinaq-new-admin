import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { normalizeError } from '@/lib/errors'
import { questionKeys } from '@/features/questions/api/keys'
import {
  questionRowSchema,
  type QuestionRow,
} from '@/features/questions/schemas'

export const throughputSchema = z.object({
  queued: z.number(),
  running: z.number(),
  structured_hour: z.number(),
  structured_today: z.number(),
  failed_today: z.number(),
  auto_approved_today: z.number(),
  spend_today: z.coerce.number(),
})

export type Throughput = z.infer<typeof throughputSchema>

const clearQueueSchema = z.object({ cleared: z.number(), held: z.number() })

/**
 * Put questions in line for structuring. Rows a worker is actively holding are
 * skipped rather than reset — clearing their lease would let a second worker
 * claim a question the first is still spending money on. Returns how many rows
 * actually entered the queue.
 */
export async function enqueueQuestions(ids: number[]): Promise<number> {
  if (!ids.length) return 0
  const { data, error } = await supabase.rpc('enqueue_questions', { p_ids: ids })
  if (error) throw error
  return Number(data ?? 0)
}

/**
 * Empties the queue except for batches a worker is still holding: nulling
 * their lease would let the next enqueue hand the same questions to a second
 * worker while the first is still paying for them. Held rows leave the queue
 * by themselves when their worker finishes.
 */
export async function clearQueue(): Promise<{ cleared: number; held: number }> {
  const { data, error } = await supabase.rpc('clear_queue')
  if (error) throw error
  return clearQueueSchema.parse(data)
}

/**
 * Take the next batch. Two workers calling this concurrently get disjoint
 * rows (`for update skip locked` in the RPC), so a second tab adds throughput
 * instead of duplicating spend.
 */
export async function claimQuestions(
  limit: number,
  bookId?: number,
): Promise<QuestionRow[]> {
  const { data, error } = await supabase.rpc('claim_questions', {
    p_limit: limit,
    ...(bookId ? { p_book_id: bookId } : {}),
  })
  if (error) throw error
  return z.array(questionRowSchema).parse(data ?? [])
}

/** Releases the lease and takes the rows out of the queue — work finished. */
export async function finishQuestions(ids: number[]): Promise<void> {
  if (!ids.length) return
  const { error } = await supabase
    .from('questions')
    .update({ queued_at: null, claimed_at: null })
    .in('id', ids)
  if (error) throw error
}

/**
 * Hands rows back so another worker can take them immediately instead of
 * waiting out the lease. The attempt is given back too: stopping the worker is
 * not a failed attempt, and counting it as one used to retire rows that had
 * never actually been processed after three stop/starts.
 */
export async function releaseQuestions(ids: number[]): Promise<void> {
  if (!ids.length) return
  const { error } = await supabase.rpc('release_questions', { p_ids: ids })
  if (error) throw error
}

/**
 * Keeps the batch in flight. The lease is sized for a normal batch, but a
 * figure-heavy one — or one waiting out a provider's rate limit — can outrun
 * it, and a reclaimed row is a row two workers pay for.
 */
export async function renewClaims(ids: number[]): Promise<void> {
  if (!ids.length) return
  const { error } = await supabase.rpc('renew_claims', { p_ids: ids })
  if (error) throw error
}

export async function nextQueuedBook(): Promise<number | null> {
  const { data, error } = await supabase.rpc('next_queued_book')
  if (error) throw error
  return typeof data === 'number' ? data : null
}

export function useThroughput(enabled = true) {
  return useQuery({
    queryKey: questionKeys.throughput(),
    queryFn: async (): Promise<Throughput> => {
      const { data, error } = await supabase.rpc('questions_throughput')
      if (error) throw error
      return throughputSchema.parse(data)
    },
    // The queue moves while the operator watches it; a stale count reads as
    // a stalled worker.
    refetchInterval: enabled ? 5_000 : 30_000,
    staleTime: 0,
  })
}

export function useEnqueue() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (ids: number[]) => enqueueQuestions(ids),
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: questionKeys.all })
      toast.success(`${count} sual növbəyə əlavə edildi`)
    },
    onError: (error) => toast.error(normalizeError(error).message),
  })
}

export function useClearQueue() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: clearQueue,
    onSuccess: ({ cleared, held }) => {
      queryClient.invalidateQueries({ queryKey: questionKeys.all })
      ;(held ? toast.warning : toast.success)(
        `${cleared} sual növbədən çıxarıldı` +
          (held ? `, ${held} hazırda işlənir və toxunulmadı` : ''),
      )
    },
    onError: (error) => toast.error(normalizeError(error).message),
  })
}

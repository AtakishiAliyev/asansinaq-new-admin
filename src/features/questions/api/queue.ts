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

/**
 * Put questions in line for structuring. Enqueueing is free and reversible —
 * the spend happens when a worker claims the row, which is why this is a
 * plain write and the claim is the guarded RPC.
 */
export async function enqueueQuestions(ids: number[]): Promise<number> {
  if (!ids.length) return 0
  const { error } = await supabase
    .from('questions')
    .update({ queued_at: new Date().toISOString(), claimed_at: null, attempts: 0 })
    .in('id', ids)
  if (error) throw error
  return ids.length
}

export async function dequeueQuestions(ids: number[]): Promise<void> {
  if (!ids.length) return
  const { error } = await supabase
    .from('questions')
    .update({ queued_at: null, claimed_at: null })
    .in('id', ids)
  if (error) throw error
}

/** Clears the whole queue, including rows another tab is holding. */
export async function clearQueue(): Promise<void> {
  const { error } = await supabase
    .from('questions')
    .update({ queued_at: null, claimed_at: null })
    .not('queued_at', 'is', null)
  if (error) throw error
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
 * Hands rows back to the queue without consuming an attempt's worth of time:
 * used when a run is stopped mid-batch, so another worker can take them
 * immediately instead of waiting out the 15-minute lease.
 */
export async function releaseQuestions(ids: number[]): Promise<void> {
  if (!ids.length) return
  const { error } = await supabase
    .from('questions')
    .update({ claimed_at: null })
    .in('id', ids)
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: questionKeys.all })
      toast.success('Növbə boşaldıldı')
    },
    onError: (error) => toast.error(normalizeError(error).message),
  })
}

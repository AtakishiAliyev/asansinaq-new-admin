import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { normalizeError } from '@/lib/errors'
import { questionKeys } from '@/features/questions/api/keys'

// Claiming, renewing, releasing and finishing all left with the browser
// worker. They are the worker's RPCs now — the *_worker variants, matched on a
// worker id — and a second implementation reachable from a tab would be a
// second thing that can take a lease. What the browser still owns is putting
// work IN: enqueue and clear.
export const throughputSchema = z.object({
  queued: z.number(),
  running: z.number(),
  /** Submitted to the provider and waiting. A subset of `running`. */
  in_batch: z.number(),
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

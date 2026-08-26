import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import { normalizeError } from '@/lib/errors'
import { questionKeys } from '@/features/questions/api/keys'

// The worker's control plane, read and written from the review screen.
//
// The process itself is not here and must not be: it runs as a daemon so that
// closing this tab does not end a run, which is the whole reason the batch lane
// exists. What this file talks to is a switch and a heartbeat.

/**
 * How stale a heartbeat may be before the worker counts as offline.
 *
 * The worker beats once per pass and its poll interval is a minute, so two and
 * a half minutes is a missed beat plus room for a slow one. Shorter and a
 * healthy worker flickers offline while it waits on a provider; much longer and
 * a dead one looks alive for as long as an operator is willing to stare at it.
 */
export const HEARTBEAT_STALE_MS = 150_000

export const workerHeartbeatSchema = z.object({
  worker_id: z.string(),
  last_seen: z.string(),
  activity: z.string(),
  state: z.enum(['running', 'paused']),
  spend_today: z.number().nullable(),
  budget_usd: z.number().nullable(),
  last_error: z.string().nullable(),
  last_error_at: z.string().nullable(),
  started_at: z.string().nullable(),
  stopped_at: z.string().nullable(),
})

export type WorkerHeartbeat = z.infer<typeof workerHeartbeatSchema>

export interface WorkerStatus {
  desiredState: 'running' | 'paused'
  /** Every worker that has ever reported, most recently seen first. */
  workers: (WorkerHeartbeat & { online: boolean; ageMs: number })[]
  /** True when at least one worker has beaten recently. */
  anyOnline: boolean
}

export function useWorkerStatus() {
  return useQuery({
    queryKey: questionKeys.worker(),
    queryFn: async (): Promise<WorkerStatus> => {
      const [control, heartbeats] = await Promise.all([
        supabase.from('worker_control').select('desired_state').eq('id', 1).maybeSingle(),
        supabase.from('worker_heartbeat').select('*').order('last_seen', { ascending: false }),
      ])
      if (control.error) throw control.error
      if (heartbeats.error) throw heartbeats.error

      const now = Date.now()
      const workers = (heartbeats.data ?? []).map((row) => {
        const parsed = workerHeartbeatSchema.parse(row)
        const ageMs = now - new Date(parsed.last_seen).getTime()
        // A deliberate stop is known immediately; only a crash has to be
        // inferred from silence. Without this a worker shut down on purpose
        // showed as running for the whole staleness window, next to its own
        // "stopped" activity line.
        const online = ageMs < HEARTBEAT_STALE_MS && parsed.stopped_at === null
        return { ...parsed, ageMs, online }
      })
      return {
        desiredState: control.data?.desired_state === 'paused' ? 'paused' : 'running',
        workers,
        anyOnline: workers.some((w) => w.online),
      }
    },
    // Liveness is judged from the age of a timestamp, so the page has to keep
    // asking: without a refetch a worker that died looks online for as long as
    // the tab stays open.
    refetchInterval: 5_000,
    staleTime: 0,
  })
}

export function useSetWorkerState() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (desired: 'running' | 'paused') => {
      const { data: userData } = await supabase.auth.getUser()
      const { error } = await supabase
        .from('worker_control')
        .update({
          desired_state: desired,
          updated_at: new Date().toISOString(),
          updated_by: userData.user?.id ?? null,
        })
        .eq('id', 1)
      if (error) throw error
      return desired
    },
    onSuccess: (desired) => {
      queryClient.invalidateQueries({ queryKey: questionKeys.worker() })
      // Deliberately not "worker paused": this wrote a request, and the worker
      // acts on it at the end of its current pass. Saying it had stopped would
      // be a claim about a process this tab cannot see.
      toast.success(
        desired === 'paused'
          ? 'Dayandırma tələbi yazıldı — worker cari mərhələni bitirib dayanacaq'
          : 'İşə salma tələbi yazıldı — worker növbəti dövrədə götürəcək',
      )
    },
    onError: (error) =>
      toast.error(`Worker vəziyyəti dəyişmədi: ${normalizeError(error).message}`),
  })
}

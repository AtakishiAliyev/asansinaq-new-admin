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
  /** The operator's express override. The worker also enters express on its
   *  own for a small queue, so false does NOT mean the next run is batched. */
  express: boolean
  /** Today's spend split by which lane paid for it. Rows written before the
   *  column existed are counted as neither — see `via_batch`. */
  spend: { batch: number; express: number }
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
        supabase.from('worker_control').select('desired_state, express').eq('id', 1).maybeSingle(),
        supabase.from('worker_heartbeat').select('*').order('last_seen', { ascending: false }),
      ])
      if (control.error) throw control.error
      if (heartbeats.error) throw heartbeats.error

      // Which lane paid for today, so the panel can show what express cost.
      const since = new Date()
      since.setHours(0, 0, 0, 0)
      const ledger = await supabase
        .from('ops_log')
        .select('est_cost_usd, via_batch')
        .gte('created_at', since.toISOString())
      const spend = { batch: 0, express: 0 }
      for (const entry of ledger.data ?? []) {
        if (entry.via_batch === null) continue
        spend[entry.via_batch ? 'batch' : 'express'] += Number(entry.est_cost_usd ?? 0)
      }

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
        express: control.data?.express === true,
        spend,
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

/**
 * Turn the express override on or off.
 *
 * Separate from the run/pause switch because it answers a different question.
 * Pause is "should the worker be working"; this is "how much is a run allowed
 * to cost in order to finish sooner" — and the worker reads it at the top of
 * every pass, so it takes effect on the next set rather than the current one.
 */
export function useSetExpress() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (express: boolean) => {
      const { data: userData } = await supabase.auth.getUser()
      const { error } = await supabase
        .from('worker_control')
        .update({
          express,
          updated_at: new Date().toISOString(),
          updated_by: userData.user?.id ?? null,
        })
        .eq('id', 1)
      if (error) throw error
      return express
    },
    onSuccess: (express) => {
      queryClient.invalidateQueries({ queryKey: questionKeys.worker() })
      toast.success(
        express
          ? 'Express açıldı — növbəti dəst sinxron işlənəcək (tam qiymət)'
          : 'Express bağlandı — böyük dəstlər yenidən batch ilə (yarı qiymət)',
      )
    },
    onError: (error) => toast.error(`Express dəyişmədi: ${normalizeError(error).message}`),
  })
}

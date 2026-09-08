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
const HEARTBEAT_STALE_MS = 150_000

const workerHeartbeatSchema = z.object({
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
  /** The operator's express switch, and the whole rule: on means every
   *  question runs synchronously — structuring and verification — at any size;
   *  off means every question goes to the batch queue, however few. */
  express: boolean
  /** Approve, without a reviewer, questions that cleared every automatic
   *  check. Read by the WORKER, which is why it lives here and not in a
   *  browser store — see the migration for what happened when it did. */
  autoApprove: boolean
  /** While auto-approving, pass only questions that already have an answer. */
  autoApproveNeedsAnswer: boolean
  /** Today's spend split by which lane paid for it. Rows written before the
   *  column existed are counted as neither — see `via_batch`. */
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
        supabase
          .from('worker_control')
          .select(
            'desired_state, express, auto_approve, auto_approve_needs_answer',
          )
          .eq('id', 1)
          .maybeSingle(),
        supabase
          .from('worker_heartbeat')
          .select('*')
          .order('last_seen', { ascending: false }),
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
        desiredState:
          control.data?.desired_state === 'paused' ? 'paused' : 'running',
        express: control.data?.express === true,
        autoApprove: control.data?.auto_approve === true,
        autoApproveNeedsAnswer:
          control.data?.auto_approve_needs_answer !== false,
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
      toast.error(
        `Worker vəziyyəti dəyişmədi: ${normalizeError(error).message}`,
      ),
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
/**
 * Turn auto-approve on or off, and whether it requires an answer.
 *
 * Written to the worker's control plane rather than to a browser store,
 * because the worker is what acts on it. The switch used to write to a store
 * nothing read: it had lost its only reader when structuring moved off the
 * browser, so for that whole period the dialog offered a control with nothing
 * on the other end and not one row was ever auto-approved.
 */
export function useSetAutoApprove() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (patch: {
      autoApprove?: boolean
      autoApproveNeedsAnswer?: boolean
    }) => {
      const { data: userData } = await supabase.auth.getUser()
      const { error } = await supabase
        .from('worker_control')
        .update({
          ...(patch.autoApprove !== undefined
            ? { auto_approve: patch.autoApprove }
            : {}),
          ...(patch.autoApproveNeedsAnswer !== undefined
            ? { auto_approve_needs_answer: patch.autoApproveNeedsAnswer }
            : {}),
          updated_at: new Date().toISOString(),
          updated_by: userData.user?.id ?? null,
        })
        .eq('id', 1)
      if (error) throw error
      return patch
    },
    onSuccess: (patch) => {
      queryClient.invalidateQueries({ queryKey: questionKeys.worker() })
      if (patch.autoApprove !== undefined) {
        // Said as a request rather than as a fact: the worker reads the switch
        // at the top of its next pass, so nothing changes for rows already in
        // flight.
        toast.success(
          patch.autoApprove
            ? 'Avtomatik təsdiq açıldı — növbəti keçiddən etibarən'
            : 'Avtomatik təsdiq bağlandı',
        )
      }
    },
    onError: (error) => toast.error(normalizeError(error).message),
  })
}

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
    onError: (error) =>
      toast.error(`Express dəyişmədi: ${normalizeError(error).message}`),
  })
}

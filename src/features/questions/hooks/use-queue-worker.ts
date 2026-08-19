import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { questionKeys } from '@/features/questions/api/keys'
import {
  claimQuestions,
  finishQuestions,
  releaseQuestions,
  renewClaims,
  nextQueuedBook,
} from '@/features/questions/api/queue'
import { useStructuringRun } from '@/features/questions/hooks/use-structuring-run'
import { toCropEntries } from '@/features/questions/lib/crop-entry'
import {
  isBudgetExhausted,
  resetRateGate,
} from '@/features/questions/lib/rate-gate'
import { questionRowSchema } from '@/features/questions/schemas'
import { pipelineSettings } from '@/stores/pipeline-store'

export interface WorkerState {
  status: 'idle' | 'running' | 'stopped'
  /** questions this worker finished since it was started */
  processed: number
  approved: number
  failed: number
  book: number | null
  error?: string
}

const IDLE: WorkerState = {
  status: 'idle',
  processed: 0,
  approved: 0,
  failed: 0,
  book: null,
}

/** Questions with no error flags, an independent second read that agreed, and
 *  a category the model is confident about need no human decision. */
async function autoApprove(
  ids: number[],
  needsAnswer: boolean,
): Promise<number> {
  if (!ids.length) return 0
  const { data, error } = await supabase
    .from('questions')
    .select('*')
    .in('id', ids)
    .eq('status', 'structured')
  if (error || !data) return 0
  const rows = data.map((r) => questionRowSchema.parse(r))
  const ready = rows.filter((r) => {
    if (!r.verified || !r.ai_category_id) return false
    const flags = Array.isArray(r.flags)
      ? (r.flags as { level?: string; code?: string }[])
      : []
    // A missing answer is the operator's call, not a defect: when the knob
    // says answers are not required, its own flag must not veto what the knob
    // permits. Every other warning still blocks.
    const blocking = flags.filter(
      (f) =>
        (f.level === 'error' || f.level === 'warning') &&
        !(f.code === 'answer_missing' && !needsAnswer),
    )
    if (blocking.length) return false
    return !needsAnswer || (r.answer !== null && r.answer_source === 'key')
  })
  let done = 0
  const reviewedAt = new Date().toISOString()
  for (const row of ready) {
    const { error: updateError } = await supabase
      .from('questions')
      .update({
        status: 'approved',
        category_id: row.ai_category_id,
        auto_approved: true,
        // reviewed_by stays null: no person made this call, and recording one
        // would make the audit trail lie.
        reviewed_at: reviewedAt,
      })
      .eq('id', row.id)
      .eq('status', 'structured')
    if (!updateError) done++
  }
  return done
}

/**
 * Drains the queue batch by batch until it is empty or stopped.
 *
 * The worker runs in the browser because two pipeline steps need one: the
 * vector figure is rendered to an image before it can be compared, and crops
 * are read through the user's own session. What the queue changes is
 * ownership of the WORK: rows live in the database with a lease, so closing
 * the tab loses at most the batch in flight, reopening resumes, and a second
 * tab doubles throughput instead of doubling the bill.
 */
export function useQueueWorker() {
  const [state, setState] = useState<WorkerState>(IDLE)
  const structuring = useStructuringRun()
  const queryClient = useQueryClient()
  const running = useRef(false)
  const held = useRef<number[]>([])
  const structuringRef = useRef(structuring)
  structuringRef.current = structuring

  // Leaving the page stops the worker rather than letting an unmounted loop
  // keep spending, and hands its batch straight back so the next worker does
  // not wait out the lease. The queue itself is untouched — pressing play
  // again picks up exactly where this left off.
  useEffect(() => {
    const release = () => {
      if (held.current.length) void releaseQuestions(held.current)
    }
    window.addEventListener('pagehide', release)
    return () => {
      window.removeEventListener('pagehide', release)
      running.current = false
      structuringRef.current.stop()
      release()
    }
  }, [])

  const stop = useCallback(() => {
    running.current = false
    structuringRef.current.stop()
    setState((s) => (s.status === 'running' ? { ...s, status: 'stopped' } : s))
  }, [])

  const start = useCallback(async () => {
    if (running.current) return
    running.current = true
    setState({ ...IDLE, status: 'running' })
    // Once per job, not per batch: the gate's learned ceiling is the whole
    // point of having a gate, and it has to survive the batch boundary.
    resetRateGate()
    const settings = pipelineSettings()
    let processed = 0
    let approved = 0
    let failed = 0

    // A batch is claimed for the length of the lease. Renewing at half that
    // interval keeps a slow batch — figure generations, a provider backoff —
    // from being reclaimed and paid for a second time by the next worker.
    const heartbeat = setInterval(
      () => {
        if (held.current.length) void renewClaims(held.current).catch(() => {})
      },
      7 * 60 * 1000,
    )

    try {
      while (running.current) {
        if (isBudgetExhausted()) {
          setState((s) => ({
            ...s,
            status: 'stopped',
            error: 'Günlük büdcə bitdi — sabah davam edin və ya limiti artırın',
          }))
          break
        }
        const bookId = await nextQueuedBook()
        if (bookId === null) break
        setState((s) => ({ ...s, book: bookId }))

        const rows = await claimQuestions(settings.batchSize, bookId)
        if (!rows.length) {
          // Another worker holds everything this book has left; try the queue
          // as a whole before deciding it is empty.
          const anywhere = await claimQuestions(settings.batchSize)
          if (!anywhere.length) break
          rows.push(...anywhere)
        }
        held.current = rows.map((r) => r.id)

        const entries = await toCropEntries(rows)
        if (!entries.length) {
          // Nothing downloadable — take them out of the queue rather than
          // spinning on the same rows forever.
          await finishQuestions(held.current)
          held.current = []
          continue
        }

        // The fallback claim above can return rows from any book, so the
        // pipeline resolves each book's key and category tree itself.
        const items = await structuringRef.current.run(entries, {
          suggestCategories: true,
        })
        if (!running.current) {
          await releaseQuestions(held.current)
          held.current = []
          break
        }

        const doneIds = items.map((i) => i.row.id)
        // The run stops early when the daily budget is spent. Rows it never
        // touched go straight back to the queue instead of sitting out a
        // 15-minute lease no one is using.
        const untouched = held.current.filter((id) => !doneIds.includes(id))
        if (untouched.length) await releaseQuestions(untouched)
        failed += items.filter((i) => i.status === 'failed').length
        processed += items.length
        if (settings.autoApprove) {
          approved += await autoApprove(
            items.filter((i) => i.status === 'structured').map((i) => i.row.id),
            settings.autoApproveNeedsAnswer,
          )
        }
        await finishQuestions(doneIds)
        held.current = []
        setState((s) => ({ ...s, processed, approved, failed }))
        void queryClient.invalidateQueries({ queryKey: questionKeys.all })
      }
      setState((s) => ({
        ...s,
        status: running.current ? 'idle' : 'stopped',
        processed,
        approved,
        failed,
      }))
    } catch (error) {
      if (held.current.length) await releaseQuestions(held.current).catch(() => {})
      held.current = []
      setState((s) => ({
        ...s,
        status: 'stopped',
        error: error instanceof Error ? error.message : 'növbə dayandı',
      }))
    } finally {
      clearInterval(heartbeat)
      running.current = false
      void queryClient.invalidateQueries({ queryKey: questionKeys.all })
    }
  }, [queryClient])

  return { ...state, start, stop, batch: structuring }
}

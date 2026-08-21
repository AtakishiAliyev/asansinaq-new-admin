import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'
import { errorDetail } from '@/lib/errors'
import {
  saveAgentFailure,
  saveAgentResult,
  useAgentRun,
  type AgentOutcome,
} from '@/features/questions/hooks/use-agent-run'
import { pipelineSettings } from '@/stores/pipeline-store'
import type { QuestionRow } from '@/features/questions/schemas'

/**
 * Sends a chosen set of crops through the agent, one after another.
 *
 * Sequential on purpose. The agent's whole method is to look, produce, look
 * again — a single question issues a dozen model calls with images attached,
 * and running several at once buys a provider rate limit rather than speed.
 * The operator watches one question being worked on and can stop between any
 * two.
 *
 * Nothing here decides WHICH questions deserve it. That is the operator's
 * call: a page they already know is hard is worth the agent from the start,
 * not after the cheap path has failed on it twice.
 */

export interface BatchProgress {
  status: 'idle' | 'running' | 'stopped' | 'done'
  /** index of the question being worked on, 1-based */
  current: number
  total: number
  done: number
  gaveUp: number
  failed: number
  /** the question and step the agent is on right now */
  activity: string
  /** reasons the agent gave for giving up, worth reading */
  notes: { qNo: number; reason: string }[]
}

const IDLE: BatchProgress = {
  status: 'idle',
  current: 0,
  total: 0,
  done: 0,
  gaveUp: 0,
  failed: 0,
  activity: '',
  notes: [],
}

export function useAgentBatch() {
  const [progress, setProgress] = useState<BatchProgress>(IDLE)
  const agent = useAgentRun()
  const running = useRef(false)
  const agentRef = useRef(agent)
  agentRef.current = agent

  const stop = useCallback(() => {
    running.current = false
    agentRef.current.stop()
    setProgress((p) => (p.status === 'running' ? { ...p, status: 'stopped' } : p))
  }, [])

  const run = useCallback(async (rows: QuestionRow[]) => {
    if (running.current || !rows.length) return
    running.current = true
    const model = pipelineSettings().agentModel
    let done = 0
    let gaveUp = 0
    let failed = 0
    const notes: BatchProgress['notes'] = []
    setProgress({ ...IDLE, status: 'running', total: rows.length })

    for (const [i, row] of rows.entries()) {
      if (!running.current) break
      setProgress((p) => ({ ...p, current: i + 1, activity: `№${row.q_no}` }))

      let outcome: AgentOutcome
      try {
        outcome = await agentRef.current.run(row, model)
      } catch (error) {
        failed++
        notes.push({ qNo: row.q_no, reason: errorDetail(error) })
        setProgress((p) => ({ ...p, failed, notes: [...notes] }))
        continue
      }
      if (!running.current) break

      if (outcome.outcome === 'done') {
        try {
          await saveAgentResult(row, outcome)
          done++
        } catch (error) {
          // The agent finished and the write did not: that is a failure of
          // ours, and it must not be filed under "the agent could not do it".
          failed++
          notes.push({ qNo: row.q_no, reason: `yazıla bilmədi: ${errorDetail(error)}` })
        }
      } else {
        // Written to the row, not just counted: the agent's own account of
        // what defeated it is the most useful thing a failed run produces.
        await saveAgentFailure(row, outcome).catch(() => {})
        if (outcome.outcome === 'gave_up') {
          gaveUp++
          notes.push({
            qNo: row.q_no,
            reason: String(outcome.result?.reason ?? 'səbəb yazılmadı'),
          })
        } else {
          failed++
          notes.push({
            qNo: row.q_no,
            reason: outcome.error ?? `${outcome.outcome} — ${outcome.steps} addım`,
          })
        }
      }
      setProgress((p) => ({ ...p, done, gaveUp, failed, notes: [...notes] }))
    }

    const stopped = !running.current
    running.current = false
    setProgress((p) => ({ ...p, status: stopped ? 'stopped' : 'done', activity: '' }))
    ;(failed || gaveUp ? toast.warning : toast.success)(
      `Agent: ${done} çıxarıldı` +
        (gaveUp ? `, ${gaveUp} təslim` : '') +
        (failed ? `, ${failed} alınmadı` : ''),
      notes.length
        ? {
            // A count tells the operator that something went wrong; the reason
            // tells them what to do about it.
            description: notes
              .slice(0, 3)
              .map((n) => `№${n.qNo}: ${n.reason}`)
              .join('\n'),
            duration: 15000,
          }
        : undefined,
    )
  }, [])

  return { ...progress, agentStep: agent.step, agentActivity: agent.activity, run, stop }
}

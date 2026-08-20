import { useCallback, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { errorDetail } from '@/lib/errors'
import { EXTRACT_SYSTEM } from '@/core/extract/prompts'
import { opAgentStep } from '@/features/questions/api/question-ops'
import {
  AGENT_TOOLS,
  runAgentTool,
  type AgentContext,
  type Artefact,
} from '@/features/questions/lib/agent-tools'
import { splitDataUrl } from '@/features/questions/lib/image'
import { toCropEntries } from '@/features/questions/lib/crop-entry'
import type { QuestionRow } from '@/features/questions/schemas'

/**
 * The loop, run in the browser one turn at a time.
 *
 * It lives here rather than in the Edge Function for a plain reason: a run
 * takes minutes and the function has 150 seconds. One TURN is 5–20 seconds and
 * fits comfortably, so the function stays what it has always been — the single
 * door every model call passes through, where the key, the ledger and the
 * budget cap live. The tools stay here too, because cropping, rendering and
 * linting are already browser code.
 */

/** A loop that has not converged in twenty turns is not going to. */
const MAX_STEPS = 20

export type AgentModel = 'claude-sonnet-5' | 'claude-opus-5'

const SYSTEM = `You are transcribing one question from a scanned exam book into a question bank, working the way a careful person would: look, produce, then check your own work against the original before saying you are finished.

The transcription standard is fixed and is quoted below. Follow it exactly.

How to work:
- Start by looking at the whole crop.
- When something is too small to read or place — a row of option drawings, a label inside a diagram, a subscript — look at that region enlarged. Do not guess at what you could look at.
- For a figure, decide between cutting it from the original and drawing it as SVG. Cutting is exact and free; prefer it unless the region carries a watermark or content that does not belong to the figure. Drawing is right when the region is dirty or when the figure must be reproduced cleanly.
- After you draw, you will be shown your drawing beside the region it must match. Judge it yourself. If a point, label, angle or shape is wrong, send a corrected SVG. Repeat until it matches or you are certain it will not.
- Run \`check\` before finishing. It runs the same deterministic rules the production system runs.
- Only call \`done\` when you have verified the result against the crop with your own eyes.
- If you cannot do it faithfully, call \`give_up\` and say exactly what defeated you.

Never invent content that is not printed on the page. An empty stem is legitimate — some questions are only a diagram and five options, with the instruction printed above the group and outside this crop.

--- TRANSCRIPTION STANDARD ---
${EXTRACT_SYSTEM}`

export interface AgentOutcome {
  outcome: 'done' | 'gave_up' | 'exhausted' | 'error'
  steps: number
  /** how many times it redrew after seeing its own output */
  redraws: number
  result: Record<string, unknown> | null
  artefacts: Map<string, Artefact>
  trace: { tool: string; summary: string }[]
  error?: string
}

interface RunState {
  status: 'idle' | 'running' | 'done'
  step: number
  /** what it is doing right now, for the operator watching */
  activity: string
  outcome?: AgentOutcome
}

const IDLE: RunState = { status: 'idle', step: 0, activity: '' }

type ContentBlock = {
  type: string
  id?: string
  name?: string
  input?: Record<string, unknown>
}

export function useAgentRun() {
  const [state, setState] = useState<RunState>(IDLE)
  const runId = useRef(0)

  const stop = useCallback(() => {
    runId.current += 1
    setState((s) => (s.status === 'running' ? { ...s, status: 'done' } : s))
  }, [])

  const run = useCallback(
    async (
      row: QuestionRow,
      model: AgentModel = 'claude-sonnet-5',
    ): Promise<AgentOutcome> => {
      const id = ++runId.current
      setState({ status: 'running', step: 0, activity: 'crop yüklənir' })

      const [entry] = await toCropEntries([row])
      if (!entry) {
        const outcome: AgentOutcome = {
          outcome: 'error',
          steps: 0,
          redraws: 0,
          result: null,
          artefacts: new Map(),
          trace: [],
          error: 'crop faylı açıla bilmədi',
        }
        setState({ status: 'done', step: 0, activity: '', outcome })
        return outcome
      }

      const ctx: AgentContext = {
        cropDataUrl: entry.crop.dataUrl,
        expectedNumber: row.q_no,
        artefacts: new Map(),
        trace: [],
      }
      const { image, mime } = splitDataUrl(entry.crop.dataUrl)
      const messages: Record<string, unknown>[] = [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mime, data: image } },
            {
              type: 'text',
              text: 'Transcribe this question. Verify your own work before finishing.',
            },
          ],
        },
      ]

      const finish = (o: AgentOutcome): AgentOutcome => {
        if (runId.current === id) setState({ status: 'done', step: o.steps, activity: '', outcome: o })
        return o
      }
      const draws = () => ctx.trace.filter((t) => t.tool === 'draw').length

      for (let step = 0; step < MAX_STEPS; step++) {
        if (runId.current !== id) {
          return {
            outcome: 'error',
            steps: step,
            redraws: Math.max(0, draws() - 1),
            result: null,
            artefacts: ctx.artefacts,
            trace: ctx.trace,
            error: 'dayandırıldı',
          }
        }
        setState({ status: 'running', step: step + 1, activity: 'model düşünür' })

        let reply: { content: ContentBlock[] }
        try {
          reply = await opAgentStep({ model, system: SYSTEM, tools: AGENT_TOOLS, messages })
        } catch (error) {
          return finish({
            outcome: 'error',
            steps: step,
            redraws: Math.max(0, draws() - 1),
            result: null,
            artefacts: ctx.artefacts,
            trace: ctx.trace,
            error: errorDetail(error),
          })
        }
        messages.push({ role: 'assistant', content: reply.content })

        const uses = reply.content.filter((c) => c.type === 'tool_use')
        if (!uses.length) {
          // It stopped talking without finishing. Treated as exhaustion rather
          // than success: there is no transcription to save.
          return finish({
            outcome: 'exhausted',
            steps: step + 1,
            redraws: Math.max(0, draws() - 1),
            result: null,
            artefacts: ctx.artefacts,
            trace: ctx.trace,
          })
        }

        const results: Record<string, unknown>[] = []
        for (const use of uses) {
          const input = (use.input ?? {}) as Record<string, unknown>
          if (use.name === 'done' || use.name === 'give_up') {
            return finish({
              outcome: use.name === 'done' ? 'done' : 'gave_up',
              steps: step + 1,
              redraws: Math.max(0, draws() - 1),
              result: input,
              artefacts: ctx.artefacts,
              trace: ctx.trace,
            })
          }
          setState({ status: 'running', step: step + 1, activity: String(use.name) })
          try {
            results.push({
              type: 'tool_result',
              tool_use_id: use.id,
              content: await runAgentTool(ctx, String(use.name), input),
            })
          } catch (error) {
            // A refused box or a rejected SVG is information the agent can act
            // on, not a reason to abandon a question it has half-read.
            results.push({
              type: 'tool_result',
              tool_use_id: use.id,
              is_error: true,
              content: [{ type: 'text', text: errorDetail(error) }],
            })
          }
        }
        messages.push({ role: 'user', content: results })
      }

      return finish({
        outcome: 'exhausted',
        steps: MAX_STEPS,
        redraws: Math.max(0, draws() - 1),
        result: null,
        artefacts: ctx.artefacts,
        trace: ctx.trace,
      })
    },
    [],
  )

  return { ...state, run, stop }
}

/**
 * Writes what the agent produced. Artefacts become storage objects first: a
 * row that names an image which was never uploaded is the failure this whole
 * day was spent removing.
 */
export async function saveAgentResult(
  row: QuestionRow,
  outcome: AgentOutcome,
): Promise<void> {
  if (outcome.outcome !== 'done' || !outcome.result) {
    throw new Error('yazmaq üçün tamamlanmış nəticə yoxdur')
  }
  const base = `${row.book_id}/p${row.page_number}_c${row.col}_q${row.q_no}`
  const paths = new Map<string, string>()
  for (const [name, art] of outcome.artefacts) {
    const { image, mime } = splitDataUrl(art.dataUrl)
    const bin = atob(image)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const path = `${base}_agent_${name}.png`
    const { error } = await supabase.storage
      .from('question-crops')
      .upload(path, new Blob([bytes], { type: mime }), { upsert: true, contentType: mime })
    if (error) {
      throw new Error(`"${name}" yüklənmədi (${Math.round(bytes.length / 1024)} kb): ${errorDetail(error)}`)
    }
    paths.set(name, path)
  }

  const r = outcome.result
  const rawOptions = (r.options as Record<string, unknown>[] | undefined) ?? []
  const options = rawOptions.map((o) => {
    const named = o.image ? String(o.image) : null
    return {
      label: String(o.label ?? ''),
      ...(o.tex ? { tex: String(o.tex) } : {}),
      ...(named && paths.has(named) ? { image: paths.get(named), isImage: true } : {}),
    }
  })
  const figureName = r.figure ? String(r.figure) : null
  const figurePath = figureName ? paths.get(figureName) : undefined
  const stem = String(r.stem ?? '').trim()

  const { error } = await supabase
    .from('questions')
    .update({
      status: 'structured',
      stem: stem || null,
      options: options as never,
      figures: figurePath
        ? ({ v: 1, items: [{ kind: 'image', src: figurePath }] } as never)
        : null,
      model: 'agent',
      // The agent checked its own work; that is not the same as a second
      // independent read, and the review screen must not claim it is.
      verified: false,
      flags: [
        {
          level: 'warning',
          code: 'agent_transcribed',
          message: `Agent çıxarıb (${outcome.steps} addım${outcome.redraws ? `, ${outcome.redraws} düzəliş` : ''})${r.notes ? ` — ${String(r.notes)}` : ''}`,
        },
      ] as never,
      extraction_error: null,
    })
    .eq('id', row.id)
  if (error) throw new Error(`sətir yazılmadı: ${errorDetail(error)}`)
}

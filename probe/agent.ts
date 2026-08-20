// The loop, and nothing more.
//
// This is the whole framework: ask, run the tools it asked for, hand back the
// results, repeat. A graph library would wrap this in nodes and edges; what it
// would actually add — durable state, human interrupts, retry policy,
// tracing — the project already has, built to fit this problem. So the
// experiment tests the idea, not a dependency.

import Anthropic from '@anthropic-ai/sdk'
import { readFile } from 'node:fs/promises'
import { EXTRACT_SYSTEM } from '../src/core/extract/prompts.ts'
import {
  AGENT_MAX_STEPS,
  AGENT_SYSTEM,
  stepReminder,
} from '../src/core/extract/agent-prompt.ts'
import { EXTRACT_SYSTEM_EN } from './standard-en.ts'
import { TOOL_DEFS, runTool, type ToolContext } from './tools.ts'

/** Which language the transcription rules are written in. The operating
 *  instructions stay English either way — the variable under test is the
 *  standard, not the whole prompt. */
export type Standard = 'az' | 'en'
const STANDARDS: Record<Standard, string> = {
  az: EXTRACT_SYSTEM,
  en: EXTRACT_SYSTEM_EN,
}

export type AgentModel = 'claude-sonnet-5' | 'claude-opus-5'
/** Not thrift — a loop that has not converged in twenty steps is not going to,
 *  and the count of cases that hit this is the honest health number. */
const MAX_STEPS = AGENT_MAX_STEPS

// The operating instructions are English in both arms — how to use the tools
// is not the thing being compared. Only the transcription standard swaps, and
// each version says the same things in the same order, so a difference in the
// results is a difference in the language rather than in what was asked.
const buildSystem = (standard: Standard) =>
  standard === 'az'
    ? AGENT_SYSTEM
    : AGENT_SYSTEM.replace(EXTRACT_SYSTEM, EXTRACT_SYSTEM_EN)

export interface AgentResult {
  outcome: 'done' | 'gave_up' | 'exhausted' | 'error'
  steps: number
  toolCalls: { name: string; input: Record<string, unknown> }[]
  /** how many times it redrew a figure after seeing its own output */
  redraws: number
  final: Record<string, unknown> | null
  inputTokens: number
  outputTokens: number
  ms: number
  error?: string
}

export async function runAgent(
  ctx: ToolContext,
  standard: Standard = 'az',
  model: AgentModel = 'claude-opus-5',
): Promise<AgentResult> {
  const client = new Anthropic()
  const started = Date.now()
  const toolCalls: AgentResult['toolCalls'] = []
  let inputTokens = 0
  let outputTokens = 0

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: ctx.cropPath.endsWith('.png') ? 'image/png' : 'image/jpeg',
            data: (await readFile(ctx.cropPath)).toString('base64'),
          },
        },
        { type: 'text', text: 'Transcribe this question. Verify your own work before finishing.' },
      ],
    },
  ]

  for (let step = 0; step < MAX_STEPS; step++) {
    let response: Anthropic.Message
    try {
      response = await client.messages.create({
        model,
        max_tokens: 16000,
        // Thinking is on by default on this model; `high` effort is the right
        // setting for work where a wrong answer costs more than a slow one.
        output_config: { effort: 'high' },
        system: buildSystem(standard),
        tools: TOOL_DEFS,
        messages,
      })
    } catch (error) {
      return {
        outcome: 'error',
        steps: step,
        toolCalls,
        redraws: Math.max(0, toolCalls.filter((c) => c.name === 'draw').length - 1),
        final: null,
        inputTokens,
        outputTokens,
        ms: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      }
    }
    inputTokens += response.usage.input_tokens
    outputTokens += response.usage.output_tokens
    messages.push({ role: 'assistant', content: response.content })

    const uses = response.content.filter((c) => c.type === 'tool_use')
    if (!uses.length) {
      // It stopped without finishing: treat the same as running out of steps
      // rather than pretending the transcription exists.
      return {
        outcome: 'exhausted',
        steps: step + 1,
        toolCalls,
        redraws: Math.max(0, toolCalls.filter((c) => c.name === 'draw').length - 1),
        final: null,
        inputTokens,
        outputTokens,
        ms: Date.now() - started,
      }
    }

    const results: Anthropic.ToolResultBlockParam[] = []
    for (const use of uses) {
      const input = use.input as Record<string, unknown>
      toolCalls.push({ name: use.name, input })

      if (use.name === 'done' || use.name === 'give_up') {
        return {
          outcome: use.name === 'done' ? 'done' : 'gave_up',
          steps: step + 1,
          toolCalls,
          redraws: Math.max(0, toolCalls.filter((c) => c.name === 'draw').length - 1),
          final: input,
          inputTokens,
          outputTokens,
          ms: Date.now() - started,
        }
      }

      try {
        results.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: (await runTool(ctx, use.name, input)) as Anthropic.ToolResultBlockParam['content'],
        })
      } catch (error) {
        // A failing tool is information, not a crash: the agent should see the
        // reason and try something else, exactly as it would with a bad box.
        results.push({
          type: 'tool_result',
          tool_use_id: use.id,
          is_error: true,
          content: [
            { type: 'text', text: error instanceof Error ? error.message : String(error) },
          ],
        })
      }
    }
    results.push({ type: 'text', text: stepReminder(step + 1) } as never)
    messages.push({ role: 'user', content: results })
  }

  return {
    outcome: 'exhausted',
    steps: MAX_STEPS,
    toolCalls,
    redraws: Math.max(0, toolCalls.filter((c) => c.name === 'draw').length - 1),
    final: null,
    inputTokens,
    outputTokens,
    ms: Date.now() - started,
  }
}

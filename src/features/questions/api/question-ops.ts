import { supabase } from '@/lib/supabase'
import { scanDetectionSchema } from '@/core/segment/scan'
import {
  acquireSlot,
  noteBudgetExhausted,
  noteRateLimit,
  noteSuccess,
  noteTimeout,
  releaseSlot,
  type Lane,
} from '@/features/questions/lib/rate-gate'
import {
  compareResponseSchema,
  extractResponseSchema,
  agentStepResponseSchema,
  optionBoxesResponseSchema,
  parseAnswerKeyResponseSchema,
  redrawResponseSchema,
  suggestCategoryResponseSchema,
} from '@/features/questions/schemas'

// Thin wrappers over the question-ops Edge Function. Model keys live in
// function secrets; each call is admin-gated server-side. `error.context` is a
// Response only for HTTP failures — network errors have no body to read.
/** Carries the server's classification so callers can react, not just fail. */
export class OpError extends Error {
  readonly kind?: 'rate_limit' | 'budget'
  constructor(message: string, kind?: 'rate_limit' | 'budget') {
    super(message)
    this.name = 'OpError'
    this.kind = kind
  }
}

// Image generation is paced separately from the text models: it does not
// refuse work under pressure, it just takes longer, until calls cross their
// abort and the retries make it worse.
function laneFor(op: unknown): Lane {
  return op === 'redraw_figure' ? 'image' : 'text'
}

async function invokeOp<T>(
  body: Record<string, unknown>,
  parse: (data: unknown) => T,
): Promise<T> {
  const lane = laneFor(body.op)
  await acquireSlot(lane)
  try {
    const { data, error } = await supabase.functions.invoke('question-ops', {
      body,
    })
    if (error) {
      let message = 'model çağırışı alınmadı'
      let kind: 'rate_limit' | 'budget' | undefined
      const context = (error as { context?: unknown }).context
      if (context instanceof Response) {
        try {
          const payload = (await context.json()) as {
            error?: string
            detail?: string
            kind?: 'rate_limit' | 'budget'
          }
          if (payload.error) message = payload.error
          if (payload.detail) message += ` — ${payload.detail}`
          kind = payload.kind
        } catch {
          // non-JSON error body: keep the generic message
        }
      }
      if (kind === 'rate_limit') noteRateLimit(lane)
      if (kind === 'budget') noteBudgetExhausted()
      // A wall-clock abort is the same pressure as a 429, arriving as latency
      // instead of a refusal — the lane has to slow down for it too, or every
      // call keeps aborting at the same pace.
      if (!kind && /abort|timeout|vaxt aşım/i.test(message)) noteTimeout(lane)
      throw new OpError(message, kind)
    }
    noteSuccess(lane)
    return parse(data)
  } finally {
    releaseSlot(lane)
  }
}

export interface OpImage {
  image: string
  mime: 'image/png' | 'image/jpeg'
}

export function opExtract(input: {
  image: string
  mime: string
  figureMode: 'dsl' | 'plain' | 'raster'
  textLayerHint?: string
  testNo?: number
  expectedNumber?: number
  repairNotes?: string
  modelSwap?: boolean
}) {
  return invokeOp({ op: 'extract', ...input }, (d) =>
    extractResponseSchema.parse(d),
  )
}

/**
 * `attempt` is part of the server's cache key: a retry after a failed
 * render-compare must not be served the same image that just mismatched.
 */
export function opRedrawFigure(
  input: OpImage & {
    attempt?: number
    quality?: 'medium' | 'high'
    imageModel?: 'openai' | 'gemini'
  },
) {
  return invokeOp({ op: 'redraw_figure', ...input }, (d) =>
    redrawResponseSchema.parse(d),
  )
}

/** Where the picture options sit. Asked separately because asked in passing
 *  during extraction it comes back empty every time. */
/**
 * One turn of the agent loop. The whole conversation travels each time — that
 * is how the Messages API works — so this is the one op that is deliberately
 * not cached: no two turns are ever the same request.
 */
export function opAgentStep(input: {
  model: string
  system: string
  tools: unknown[]
  messages: unknown[]
}) {
  return invokeOp({ op: 'agent_step', ...input }, (d) =>
    agentStepResponseSchema.parse(d),
  )
}

export function opOptionBoxes(input: OpImage) {
  return invokeOp({ op: 'option_boxes', ...input }, (d) =>
    optionBoxesResponseSchema.parse(d),
  )
}

export function opCompareFigures(original: OpImage, candidate: OpImage) {
  return invokeOp({ op: 'compare_figures', original, candidate }, (d) =>
    compareResponseSchema.parse(d),
  )
}

export function opSuggestCategory(input: {
  stem: string
  options: string[]
  categories: { id: number; name: string; parentId: number | null }[]
}) {
  return invokeOp({ op: 'suggest_category', ...input }, (d) =>
    suggestCategoryResponseSchema.parse(d),
  )
}

export function opParseAnswerKey(page: OpImage) {
  return invokeOp({ op: 'parse_answer_key', ...page }, (d) =>
    parseAnswerKeyResponseSchema.parse(d),
  )
}

/**
 * Where the questions are on a scanned page. It lives here, with the other
 * ops, rather than in the import feature: segmentation is the highest-volume
 * paid call in the product, and only this path gives it the budget cap, the
 * cache and the shared rate gate.
 */
export function opDetectQuestions(page: OpImage) {
  return invokeOp({ op: 'detect_questions', ...page }, (d) =>
    scanDetectionSchema.parse(d),
  )
}

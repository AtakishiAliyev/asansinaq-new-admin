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
  extractResponseSchema,
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

/**
 * ONE structured call: the crop goes once and the forced tool returns stem,
 * options, figure spec and category together.
 *
 * The same request the worker submits in bulk, so a row re-run from the review
 * screen is read exactly as the batch would have read it. The repair round and
 * the hint-free second read are gone with the browser pipeline they belonged
 * to — verification is the worker's second wave now.
 */
export function opExtract(input: {
  image: string
  mime: string
  /** The segmenter's verdict. Chooses the model tier and nothing else. */
  hasFigure: boolean
  textLayerHint?: string
  testNo?: number
  expectedNumber?: number
  /** The book's tree, so the model files the question as it reads it. */
  categories?: { id: number; name: string; parentId: number | null }[]
}) {
  return invokeOp({ op: 'extract', ...input }, (d) =>
    extractResponseSchema.parse(d),
  )
}

/**
 * The manual image fallback, for a figure the vector DSL cannot express.
 *
 * NOT part of any automated path: nothing calls it today. It exists so the
 * review screen can offer it when that button is built. `attempt` is part of
 * the server's cache key so a retry is never served the image that just failed.
 */
export function opRedrawFigure(
  input: OpImage & { attempt?: number; quality?: 'medium' | 'high' },
) {
  return invokeOp({ op: 'redraw_figure', ...input }, (d) =>
    redrawResponseSchema.parse(d),
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

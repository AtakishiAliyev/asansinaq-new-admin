import { supabase } from '@/lib/supabase'
import {
  acquireSlot,
  noteBudgetExhausted,
  noteRateLimit,
  noteSuccess,
  releaseSlot,
} from '@/features/questions/lib/rate-gate'
import {
  compareResponseSchema,
  extractResponseSchema,
  parseAnswerKeyResponseSchema,
  redrawResponseSchema,
  suggestCategoryResponseSchema,
} from '@/features/questions/schemas'

// Thin wrappers over the question-ops Edge Function. Model keys live in
// function secrets; each call is admin-gated server-side. The invoke error
// unwrap mirrors detect-questions: error.context is a Response only for HTTP
// failures — network errors have no body to read.
/** Carries the server's classification so callers can react, not just fail. */
export class OpError extends Error {
  readonly kind?: 'rate_limit' | 'budget'
  constructor(message: string, kind?: 'rate_limit' | 'budget') {
    super(message)
    this.name = 'OpError'
    this.kind = kind
  }
}

async function invokeOp<T>(
  body: Record<string, unknown>,
  parse: (data: unknown) => T,
): Promise<T> {
  await acquireSlot()
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
      if (kind === 'rate_limit') noteRateLimit()
      if (kind === 'budget') noteBudgetExhausted()
      throw new OpError(message, kind)
    }
    noteSuccess()
    return parse(data)
  } finally {
    releaseSlot()
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
export function opRedrawFigure(input: OpImage & { attempt?: number }) {
  return invokeOp({ op: 'redraw_figure', ...input }, (d) =>
    redrawResponseSchema.parse(d),
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

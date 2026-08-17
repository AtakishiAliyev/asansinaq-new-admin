// All model calls of the question-recreation pipeline behind one admin-gated
// door: extraction, figure redraw (OpenAI images/edits — the accuracy winner
// in the MVP), render-compare, blind solve, category suggestion and
// answer-key parsing. The function ONLY talks to models — the client
// orchestrates the flow (lint, repair loop, browser figure rendering).
// Prompts/schemas/request bodies come from src/core/extract via the
// import-map alias, so the eval harness exercises the exact same requests.
import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  buildCompareFigures,
  buildExtract,
  buildParseAnswerKey,
  buildSolve,
  buildSuggestCategory,
  type FigureMode,
  type GeminiRequest,
  type ModelKey,
} from '@/core/extract/request'
import { REDRAW_PROMPT } from '@/core/extract/prompts'

const GEMINI_MODELS: Record<ModelKey, string> = {
  extract: Deno.env.get('GEMINI_EXTRACT_MODEL') ?? 'gemini-3.5-flash',
  figure: Deno.env.get('GEMINI_FIGURE_MODEL') ?? 'gemini-3.1-pro-preview',
  solve: Deno.env.get('GEMINI_SOLVE_MODEL') ?? 'gemini-3.5-flash',
  verify: Deno.env.get('GEMINI_VERIFY_MODEL') ?? 'gemini-3.5-flash',
}
const OPENAI_IMAGE_MODEL = Deno.env.get('OPENAI_IMAGE_MODEL') ?? 'gpt-image-2'

const TIMEOUT_MS = 90_000 // image generation runs longer than detection
const MAX_BASE64_LENGTH = 8_000_000

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

interface ImagePayload {
  image?: unknown
  mime?: unknown
}

function badImage(p: ImagePayload): string | null {
  if (typeof p.image !== 'string' || p.image.length === 0)
    return 'şəkil verilməyib'
  if (p.image.length > MAX_BASE64_LENGTH) return 'şəkil çox böyükdür'
  if (p.mime !== 'image/png' && p.mime !== 'image/jpeg')
    return 'yalnız JPEG/PNG dəstəklənir'
  return null
}

async function callGemini(
  req: GeminiRequest,
  attempt = 0,
): Promise<{ parsed: unknown; model: string; raw: Record<string, unknown> }> {
  const key = Deno.env.get('GEMINI_API_KEY')
  if (!key) throw new Error('GEMINI_API_KEY secret is not set')
  const model = GEMINI_MODELS[req.modelKey]
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(req.body),
        signal: controller.signal,
      },
    )
    if ((res.status === 429 || res.status >= 500) && attempt < 1) {
      void res.body?.cancel().catch(() => {})
      await new Promise((r) => setTimeout(r, 2000))
      return callGemini(req, attempt + 1)
    }
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300)
      throw new Error(`Gemini ${res.status}: ${detail}`)
    }
    const out = (await res.json()) as Record<string, unknown>
    const candidates = out.candidates as
      | { content?: { parts?: { text?: string }[] }; finishReason?: string }[]
      | undefined
    const text = candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) {
      const finishReason = candidates?.[0]?.finishReason
      throw new Error(
        `model boş cavab qaytardı${finishReason ? ` (finishReason: ${finishReason})` : ''}`,
      )
    }
    return { parsed: JSON.parse(text), model, raw: out }
  } finally {
    clearTimeout(timer)
  }
}

function base64ToBlob(base64: string, mime: string): Blob {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

// images/edits: reference image + instruction → clean redrawn figure.
async function callOpenAIRedraw(
  image: string,
  mime: string,
  attempt = 0,
): Promise<{ image: string; mime: string; model: string }> {
  const key = Deno.env.get('OPENAI_API_KEY')
  if (!key) throw new Error('OPENAI_API_KEY secret is not set')
  const form = new FormData()
  form.append('model', OPENAI_IMAGE_MODEL)
  form.append('image', base64ToBlob(image, mime), 'reference.png')
  form.append('prompt', REDRAW_PROMPT)
  form.append('size', 'auto')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: controller.signal,
    })
    if ((res.status === 429 || res.status >= 500) && attempt < 1) {
      void res.body?.cancel().catch(() => {})
      await new Promise((r) => setTimeout(r, 2000))
      return callOpenAIRedraw(image, mime, attempt + 1)
    }
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300)
      throw new Error(`OpenAI ${res.status}: ${detail}`)
    }
    const out = (await res.json()) as { data?: { b64_json?: string }[] }
    const b64 = out.data?.[0]?.b64_json
    if (!b64) throw new Error('image modeli şəkil qaytarmadı')
    return { image: b64, mime: 'image/png', model: OPENAI_IMAGE_MODEL }
  } finally {
    clearTimeout(timer)
  }
}

function usage(raw: Record<string, unknown>) {
  const u = raw.usageMetadata as
    | { promptTokenCount?: number; candidatesTokenCount?: number }
    | undefined
  return {
    promptTokens: u?.promptTokenCount ?? null,
    outputTokens: u?.candidatesTokenCount ?? null,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: req.headers.get('Authorization')! } } },
  )
  const { data: isAdmin, error: adminError } = await supabase.rpc('is_admin')
  if (adminError) {
    return json(500, { error: 'icazə yoxlaması alınmadı — yenidən cəhd edin' })
  }
  if (!isAdmin) return json(403, { error: 'icazə yoxdur' })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'yanlış sorğu gövdəsi' })
  }
  const op = body.op
  const started = Date.now()

  try {
    if (op === 'extract') {
      const bad = badImage(body)
      if (bad) return json(400, { error: bad })
      const figureMode = body.figureMode
      if (figureMode !== 'dsl' && figureMode !== 'plain' && figureMode !== 'raster') {
        return json(400, { error: 'figureMode yanlışdır' })
      }
      const { parsed, model, raw } = await callGemini(
        buildExtract({
          image: body.image as string,
          mime: body.mime as 'image/png' | 'image/jpeg',
          textLayerHint:
            typeof body.textLayerHint === 'string' ? body.textLayerHint : undefined,
          testNo: Number.isFinite(Number(body.testNo)) ? Number(body.testNo) : undefined,
          expectedNumber: Number.isFinite(Number(body.expectedNumber))
            ? Number(body.expectedNumber)
            : undefined,
          figureMode: figureMode as FigureMode,
          repairNotes:
            typeof body.repairNotes === 'string' ? body.repairNotes : undefined,
        }),
      )
      const ms = Date.now() - started
      console.log(JSON.stringify({ op, model, ms, ...usage(raw) }))
      return json(200, { wire: parsed, model, ms })
    }

    if (op === 'redraw_figure') {
      const bad = badImage(body)
      if (bad) return json(400, { error: bad })
      const out = await callOpenAIRedraw(body.image as string, body.mime as string)
      const ms = Date.now() - started
      console.log(JSON.stringify({ op, model: out.model, ms }))
      return json(200, { ...out, ms })
    }

    if (op === 'compare_figures') {
      const original = body.original as ImagePayload | undefined
      const candidate = body.candidate as ImagePayload | undefined
      const bad = (original && badImage(original)) || (candidate && badImage(candidate))
      if (!original || !candidate || bad) {
        return json(400, { error: bad || 'iki şəkil tələb olunur' })
      }
      const { parsed, model, raw } = await callGemini(
        buildCompareFigures(
          { image: original.image as string, mime: original.mime as string },
          { image: candidate.image as string, mime: candidate.mime as string },
        ),
      )
      const ms = Date.now() - started
      console.log(JSON.stringify({ op, model, ms, ...usage(raw) }))
      return json(200, { ...(parsed as Record<string, unknown>), model, ms })
    }

    if (op === 'solve') {
      if (typeof body.stem !== 'string' || !Array.isArray(body.options)) {
        return json(400, { error: 'stem/options tələb olunur' })
      }
      const figure = body.figure as ImagePayload | undefined
      if (figure) {
        const bad = badImage(figure)
        if (bad) return json(400, { error: bad })
      }
      const { parsed, model, raw } = await callGemini(
        buildSolve({
          stem: body.stem,
          options: body.options as { label: string; tex?: string }[],
          figure: figure
            ? { image: figure.image as string, mime: figure.mime as string }
            : undefined,
        }),
      )
      const ms = Date.now() - started
      console.log(JSON.stringify({ op, model, ms, ...usage(raw) }))
      return json(200, { ...(parsed as Record<string, unknown>), model, ms })
    }

    if (op === 'suggest_category') {
      if (typeof body.stem !== 'string' || !Array.isArray(body.categories)) {
        return json(400, { error: 'stem/categories tələb olunur' })
      }
      const { parsed, model, raw } = await callGemini(
        buildSuggestCategory({
          stem: body.stem,
          options: Array.isArray(body.options) ? (body.options as string[]) : [],
          categories: body.categories as {
            id: number
            name: string
            parentId: number | null
          }[],
        }),
      )
      const ms = Date.now() - started
      console.log(JSON.stringify({ op, model, ms, ...usage(raw) }))
      return json(200, { ...(parsed as Record<string, unknown>), model, ms })
    }

    if (op === 'parse_answer_key') {
      const bad = badImage(body)
      if (bad) return json(400, { error: bad })
      const { parsed, model, raw } = await callGemini(
        buildParseAnswerKey({
          image: body.image as string,
          mime: body.mime as string,
        }),
      )
      const ms = Date.now() - started
      console.log(JSON.stringify({ op, model, ms, ...usage(raw) }))
      return json(200, { ...(parsed as Record<string, unknown>), model, ms })
    }

    return json(400, { error: 'naməlum op' })
  } catch (error) {
    const ms = Date.now() - started
    const message = error instanceof Error ? error.message : 'naməlum xəta'
    const isTimeout = error instanceof DOMException && error.name === 'AbortError'
    console.log(JSON.stringify({ op, error: message.slice(0, 200), ms }))
    return json(502, {
      error: isTimeout ? 'model cavabı vaxt aşımına uğradı' : 'model çağırışı alınmadı',
      detail: message.slice(0, 300),
    })
  }
})

// All model calls of the question-recreation pipeline behind one admin-gated
// door: extraction, figure redraw (OpenAI images/edits — the accuracy winner
// in the MVP), render-compare, blind solve, category suggestion and
// answer-key parsing. The function ONLY talks to models — the client
// orchestrates the flow (lint, repair loop, browser figure rendering).
// Prompts/schemas/request bodies come from src/core/extract via the
// import-map alias, so the eval harness exercises the exact same requests.
//
// Cost controls: every call is logged to ops_log with an estimated cost and
// refused once today's total passes DAILY_BUDGET_USD; deterministic ops are
// cached in ops_cache (images in the question-crops bucket under cache/), so
// a re-sent crop never bills the model twice for the same request.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
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
import { PROMPT_VERSION, REDRAW_PROMPT } from '@/core/extract/prompts'

const GEMINI_MODELS: Record<ModelKey, string> = {
  extract: Deno.env.get('GEMINI_EXTRACT_MODEL') ?? 'gemini-3.5-flash',
  figure: Deno.env.get('GEMINI_FIGURE_MODEL') ?? 'gemini-3.1-pro-preview',
  solve: Deno.env.get('GEMINI_SOLVE_MODEL') ?? 'gemini-3.5-flash',
  verify: Deno.env.get('GEMINI_VERIFY_MODEL') ?? 'gemini-3.5-flash',
}
const OPENAI_IMAGE_MODEL = Deno.env.get('OPENAI_IMAGE_MODEL') ?? 'gpt-image-2'
const DAILY_BUDGET_USD = Number(Deno.env.get('DAILY_BUDGET_USD') ?? '20')

const TIMEOUT_MS = 90_000 // image generation runs longer than detection
const MAX_BASE64_LENGTH = 8_000_000

// Rough $/1M-token rates for the ESTIMATE column — visibility and the budget
// guard, not billing. Update alongside model secrets.
const RATE = {
  flashIn: 0.3,
  flashOut: 2.5,
  proIn: 2.5,
  proOut: 15,
  imageFlat: 0.08,
}

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

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(input),
  )
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function estGeminiCost(
  model: string,
  promptTokens: number | null,
  outputTokens: number | null,
): number {
  const pro = model.includes('pro')
  const inRate = pro ? RATE.proIn : RATE.flashIn
  const outRate = pro ? RATE.proOut : RATE.flashOut
  return (
    ((promptTokens ?? 0) * inRate + (outputTokens ?? 0) * outRate) / 1_000_000
  )
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

interface OpLogEntry {
  op: string
  model: string
  promptTokens: number | null
  outputTokens: number | null
  ms: number
  cost: number
  cached: boolean
}

// The log line must never fail the operator's op — warn and continue.
async function logOp(
  supabase: SupabaseClient,
  userId: string | null,
  entry: OpLogEntry,
): Promise<void> {
  const { error } = await supabase.from('ops_log').insert({
    op: entry.op,
    model: entry.model,
    prompt_tokens: entry.promptTokens,
    output_tokens: entry.outputTokens,
    ms: entry.ms,
    est_cost_usd: entry.cost,
    cached: entry.cached,
    created_by: userId,
  })
  if (error) {
    console.log(
      JSON.stringify({ warn: 'ops_log insert failed', detail: error.message }),
    )
  }
  console.log(JSON.stringify(entry))
}

async function todaysSpend(supabase: SupabaseClient): Promise<number> {
  const dayStart = new Date()
  dayStart.setUTCHours(0, 0, 0, 0)
  const { data, error } = await supabase
    .from('ops_log')
    .select('est_cost_usd')
    .gte('created_at', dayStart.toISOString())
  if (error) throw new Error('büdcə yoxlaması alınmadı')
  return (data ?? []).reduce((sum, r) => sum + Number(r.est_cost_usd ?? 0), 0)
}

interface CacheRow {
  response: Record<string, unknown> | null
  image_path: string | null
  model: string | null
}

async function cacheGet(
  supabase: SupabaseClient,
  key: string,
): Promise<CacheRow | null> {
  const { data } = await supabase
    .from('ops_cache')
    .select('response, image_path, model')
    .eq('key', key)
    .maybeSingle()
  return (data as CacheRow | null) ?? null
}

async function cachePut(
  supabase: SupabaseClient,
  key: string,
  op: string,
  fields: {
    response?: Record<string, unknown>
    image_path?: string
    model?: string
  },
): Promise<void> {
  const { error } = await supabase.from('ops_cache').insert({
    key,
    op,
    response: fields.response ?? null,
    image_path: fields.image_path ?? null,
    model: fields.model ?? null,
  })
  if (error) {
    console.log(
      JSON.stringify({ warn: 'ops_cache insert failed', detail: error.message }),
    )
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
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id ?? null

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'yanlış sorğu gövdəsi' })
  }
  const op = String(body.op ?? '')
  const started = Date.now()

  try {
    const spend = await todaysSpend(supabase)
    if (spend >= DAILY_BUDGET_USD) {
      return json(429, {
        error: `günlük model büdcəsi dolub ($${DAILY_BUDGET_USD}) — sabah davam edin və ya DAILY_BUDGET_USD secret-ini artırın`,
      })
    }

    if (op === 'extract') {
      const bad = badImage(body)
      if (bad) return json(400, { error: bad })
      const figureMode = body.figureMode
      if (figureMode !== 'dsl' && figureMode !== 'plain' && figureMode !== 'raster') {
        return json(400, { error: 'figureMode yanlışdır' })
      }
      const input = {
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
        modelSwap: body.modelSwap === true,
      }
      const key = await sha256Hex(JSON.stringify({ v: PROMPT_VERSION, op, ...input }))
      const hit = await cacheGet(supabase, key)
      if (hit?.response) {
        const ms = Date.now() - started
        await logOp(supabase, userId, {
          op,
          model: hit.model ?? 'cache',
          promptTokens: null,
          outputTokens: null,
          ms,
          cost: 0,
          cached: true,
        })
        return json(200, { ...hit.response, ms, cached: true })
      }
      const { parsed, model, raw } = await callGemini(buildExtract(input))
      const ms = Date.now() - started
      const u = usage(raw)
      const cost = estGeminiCost(model, u.promptTokens, u.outputTokens)
      await cachePut(supabase, key, op, {
        response: { wire: parsed, model },
        model,
      })
      await logOp(supabase, userId, { op, model, ...u, ms, cost, cached: false })
      return json(200, { wire: parsed, model, ms })
    }

    if (op === 'redraw_figure') {
      const bad = badImage(body)
      if (bad) return json(400, { error: bad })
      const key = await sha256Hex(
        JSON.stringify({ v: PROMPT_VERSION, op, image: body.image, mime: body.mime }),
      )
      const hit = await cacheGet(supabase, key)
      if (hit?.image_path) {
        const { data: blob } = await supabase.storage
          .from('question-crops')
          .download(hit.image_path)
        if (blob) {
          const buf = new Uint8Array(await blob.arrayBuffer())
          let bin = ''
          for (const b of buf) bin += String.fromCharCode(b)
          const ms = Date.now() - started
          await logOp(supabase, userId, {
            op,
            model: hit.model ?? 'cache',
            promptTokens: null,
            outputTokens: null,
            ms,
            cost: 0,
            cached: true,
          })
          return json(200, {
            image: btoa(bin),
            mime: 'image/png',
            model: hit.model ?? 'cache',
            ms,
            cached: true,
          })
        }
        // cache row without its object (cleaned up?): fall through and re-run
      }
      const out = await callOpenAIRedraw(body.image as string, body.mime as string)
      const ms = Date.now() - started
      const path = `cache/${key}.png`
      const { error: uploadError } = await supabase.storage
        .from('question-crops')
        .upload(path, base64ToBlob(out.image, out.mime), {
          upsert: true,
          contentType: out.mime,
        })
      if (!uploadError) {
        await cachePut(supabase, key, op, { image_path: path, model: out.model })
      }
      await logOp(supabase, userId, {
        op,
        model: out.model,
        promptTokens: null,
        outputTokens: null,
        ms,
        cost: RATE.imageFlat,
        cached: false,
      })
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
      const u = usage(raw)
      await logOp(supabase, userId, {
        op,
        model,
        ...u,
        ms,
        cost: estGeminiCost(model, u.promptTokens, u.outputTokens),
        cached: false,
      })
      return json(200, { ...(parsed as Record<string, unknown>), model, ms })
    }

    if (op === 'solve' || op === 'suggest_category' || op === 'parse_answer_key') {
      let request: GeminiRequest
      let cachePayload: Record<string, unknown>
      if (op === 'solve') {
        if (typeof body.stem !== 'string' || !Array.isArray(body.options)) {
          return json(400, { error: 'stem/options tələb olunur' })
        }
        const figure = body.figure as ImagePayload | undefined
        if (figure) {
          const bad = badImage(figure)
          if (bad) return json(400, { error: bad })
        }
        request = buildSolve({
          stem: body.stem,
          options: body.options as { label: string; tex?: string }[],
          figure: figure
            ? { image: figure.image as string, mime: figure.mime as string }
            : undefined,
        })
        cachePayload = {
          stem: body.stem,
          options: body.options,
          figure: figure?.image ?? null,
        }
      } else if (op === 'suggest_category') {
        if (typeof body.stem !== 'string' || !Array.isArray(body.categories)) {
          return json(400, { error: 'stem/categories tələb olunur' })
        }
        request = buildSuggestCategory({
          stem: body.stem,
          options: Array.isArray(body.options) ? (body.options as string[]) : [],
          categories: body.categories as {
            id: number
            name: string
            parentId: number | null
          }[],
        })
        cachePayload = {
          stem: body.stem,
          options: body.options,
          categories: body.categories,
        }
      } else {
        const bad = badImage(body)
        if (bad) return json(400, { error: bad })
        request = buildParseAnswerKey({
          image: body.image as string,
          mime: body.mime as string,
        })
        cachePayload = { image: body.image, mime: body.mime }
      }

      const key = await sha256Hex(
        JSON.stringify({ v: PROMPT_VERSION, op, ...cachePayload }),
      )
      const hit = await cacheGet(supabase, key)
      if (hit?.response) {
        const ms = Date.now() - started
        await logOp(supabase, userId, {
          op,
          model: hit.model ?? 'cache',
          promptTokens: null,
          outputTokens: null,
          ms,
          cost: 0,
          cached: true,
        })
        return json(200, { ...hit.response, ms, cached: true })
      }
      const { parsed, model, raw } = await callGemini(request)
      const ms = Date.now() - started
      const u = usage(raw)
      const responseBody = { ...(parsed as Record<string, unknown>), model }
      await cachePut(supabase, key, op, { response: responseBody, model })
      await logOp(supabase, userId, {
        op,
        model,
        ...u,
        ms,
        cost: estGeminiCost(model, u.promptTokens, u.outputTokens),
        cached: false,
      })
      return json(200, { ...responseBody, ms })
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

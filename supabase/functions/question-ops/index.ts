// All model calls of the question-recreation pipeline behind one admin-gated
// door: extraction, figure redraw (OpenAI images/edits — the accuracy winner
// in the MVP), render-compare, category suggestion and answer-key parsing.
// A question's answer is never produced here — it comes from the printed key
// or the reviewer, so there is deliberately no solve op. The function ONLY talks to models — the client
// orchestrates the flow (lint, repair loop, browser figure rendering).
// Prompts/schemas/request bodies come from src/core/extract via the
// import-map alias, so the eval harness exercises the exact same requests.
//
// Cost controls: every call is logged to ops_log with an estimated cost and
// refused once today's total passes DAILY_BUDGET_USD; deterministic ops are
// cached in ops_cache (images in the question-crops bucket under cache/), so
// a re-sent crop never bills the model twice for the same request. The budget
// is checked immediately before each model call, never before dispatch — a
// cache hit costs nothing and must keep serving after the cap is reached,
// otherwise a capped day turns cached questions into permanent failures.
//
// Two Supabase clients on purpose: the caller's JWT answers "is this an
// admin?", and only the service role writes the ledger, the cache and the
// cached images. The browser can read ops_log but cannot forge a row in it.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import {
  buildCompareFigures,
  buildDetectQuestions,
  buildOptionBoxes,
  buildExtract,
  buildParseAnswerKey,
  buildSuggestCategory,
  type FigureMode,
  type GeminiRequest,
  type ModelKey,
} from '@/core/extract/request'
import { PROMPT_VERSION, REDRAW_PROMPT } from '@/core/extract/prompts'

const GEMINI_MODELS: Record<ModelKey, string> = {
  extract: Deno.env.get('GEMINI_EXTRACT_MODEL') ?? 'gemini-3.5-flash',
  figure: Deno.env.get('GEMINI_FIGURE_MODEL') ?? 'gemini-3.1-pro-preview',
  verify: Deno.env.get('GEMINI_VERIFY_MODEL') ?? 'gemini-3.5-flash',
  detect: Deno.env.get('GEMINI_DETECT_MODEL') ?? 'gemini-3.5-flash',
}
const OPENAI_IMAGE_MODEL = Deno.env.get('OPENAI_IMAGE_MODEL') ?? 'gpt-image-2'
const DAILY_BUDGET_USD = Number(Deno.env.get('DAILY_BUDGET_USD') ?? '20')

// A strong model reading a dense figure page routinely passes 90s; the
// client retries on a fresh invocation, so this only has to cover one attempt.
// Measured, not guessed: once the figure lane began returning an SVG with the
// text, extract on the figure model went from a 22 s average to 95 s, with a
// 111 s peak. At 120 s the tail was landing on the ceiling and a question that
// had been fully read was thrown away for it.
const TIMEOUT_MS = 135_000
// Complex references push gpt-image past 90s; stay just under the edge
// function's own wall-clock budget so WE report the timeout, not the platform.
const IMAGE_TIMEOUT_MS = 140_000
// The whole request's wall clock. Per-call timeouts alone were not enough: a
// retry used to arm a full fresh timeout, so a slow call plus its retry could
// outlive the function and be killed by the platform — the client then saw a
// generic failure instead of our timeout message.
const REQUEST_BUDGET_MS = 145_000
const MAX_BASE64_LENGTH = 8_000_000

// Rough $/1M-token rates for the ESTIMATE column — visibility and the budget
// guard, not billing. Update alongside model secrets.
const RATE = {
  flashIn: 0.3,
  flashOut: 2.5,
  proIn: 2.5,
  proOut: 15,
  imageFlat: 0.08,
  imageMedium: 0.04,
  // Anthropic, per million tokens. Sonnet 5 carries an introductory rate
  // through 2026-08-31; after that it is 3/15 and this table needs a look.
  sonnetIn: 2,
  sonnetOut: 10,
  opusIn: 5,
  opusOut: 25,
}

const AGENT_MODELS = new Set([
  'claude-sonnet-5',
  'claude-opus-5',
  'gemini-3.1-pro-preview',
  'gemini-3.5-flash',
])

// ── The agent loop speaks one shape; two providers speak two others ──────────
//
// The browser keeps the conversation in Anthropic's shape and resends it whole
// each turn. Rather than teach the loop a second dialect — and then keep two
// loops honest against each other forever — the translation lives here, at the
// door, and the loop never learns that Gemini exists.
//
// The awkward part is tool results. Anthropic lets a tool hand back images
// inside the result block; Gemini's functionResponse carries JSON only. So a
// result splits: the text goes in the functionResponse, and the images follow
// it as inlineData parts of the same user turn, which is how a Gemini
// conversation carries pictures at all.

interface AnthropicBlock {
  type: string
  text?: string
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  content?: unknown
  source?: { media_type?: string; data?: string }
}

function toGeminiContents(messages: Record<string, unknown>[]) {
  // functionResponse needs the name of the call it answers, and Anthropic
  // identifies that by id — so the ids seen so far are kept.
  const nameById = new Map<string, string>()
  const contents: Record<string, unknown>[] = []

  for (const message of messages) {
    const role = message.role === 'assistant' ? 'model' : 'user'
    const raw = message.content
    const blocks: AnthropicBlock[] = Array.isArray(raw)
      ? (raw as AnthropicBlock[])
      : [{ type: 'text', text: String(raw ?? '') }]

    // A turn answering tools becomes two: the function responses on their own,
    // then anything they carried. Gemini rejects a content that mixes a
    // functionResponse with other part types, and our tools answer with
    // pictures — a cut to look at, a drawing beside the region it copies.
    const responses: Record<string, unknown>[] = []
    const rest: Record<string, unknown>[] = []

    for (const b of blocks) {
      if (b.type === 'text' && b.text) {
        rest.push({ text: b.text })
      } else if (b.type === 'image' && b.source?.data) {
        rest.push({
          inlineData: {
            mimeType: b.source.media_type ?? 'image/png',
            data: b.source.data,
          },
        })
      } else if (b.type === 'tool_use' && b.name) {
        if (b.id) nameById.set(b.id, b.name)
        rest.push({ functionCall: { name: b.name, args: b.input ?? {} } })
      } else if (b.type === 'tool_result') {
        const name = nameById.get(String(b.tool_use_id ?? '')) ?? 'tool'
        const inner: AnthropicBlock[] = Array.isArray(b.content)
          ? (b.content as AnthropicBlock[])
          : [{ type: 'text', text: String(b.content ?? '') }]
        const text = inner
          .filter((c) => c.type === 'text' && c.text)
          .map((c) => c.text)
          .join('\n')
        responses.push({
          functionResponse: { name, response: { result: text || 'ok' } },
        })
        for (const c of inner) {
          if (c.type === 'image' && c.source?.data) {
            rest.push({
              inlineData: {
                mimeType: c.source.media_type ?? 'image/png',
                data: c.source.data,
              },
            })
          }
        }
      }
    }

    if (responses.length) contents.push({ role: 'user', parts: responses })
    if (rest.length) contents.push({ role, parts: rest })
  }
  return contents
}

function toGeminiTools(tools: Record<string, unknown>[]) {
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      })),
    },
  ]
}

/** Gemini's answer, in the shape the loop already understands. */
function fromGeminiParts(parts: Record<string, unknown>[]): AnthropicBlock[] {
  const out: AnthropicBlock[] = []
  let n = 0
  for (const part of parts) {
    if (typeof part.text === 'string' && part.text) {
      out.push({ type: 'text', text: part.text })
    }
    const call = part.functionCall as { name?: string; args?: unknown } | undefined
    if (call?.name) {
      out.push({
        type: 'tool_use',
        // Gemini has no call ids; the loop needs one to match results back.
        id: `gemini_${Date.now()}_${n++}`,
        name: call.name,
        input: (call.args ?? {}) as Record<string, unknown>,
      })
    }
  }
  return out
}

function estAnthropicCost(
  model: string,
  inputTokens: number | null,
  outputTokens: number | null,
): number {
  const opus = model.includes('opus')
  const inRate = opus ? RATE.opusIn : RATE.sonnetIn
  const outRate = opus ? RATE.opusOut : RATE.sonnetOut
  return (((inputTokens ?? 0) * inRate + (outputTokens ?? 0) * outRate) / 1_000_000)
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

// Every attempt is armed with what is LEFT of the request's wall clock, so a
// retry can never push the function past the platform's own limit.
function remainingMs(deadline: number, perCallTimeout: number): number {
  return Math.max(0, Math.min(perCallTimeout, deadline - Date.now()))
}

function deadlineExceeded(): DOMException {
  return new DOMException('request deadline exceeded', 'AbortError')
}

async function callGemini(
  req: GeminiRequest,
  deadline: number,
  attempt = 0,
): Promise<{ parsed: unknown; model: string; raw: Record<string, unknown> }> {
  const key = Deno.env.get('GEMINI_API_KEY')
  if (!key) throw new Error('GEMINI_API_KEY secret is not set')
  const model = GEMINI_MODELS[req.modelKey]
  const budget = remainingMs(deadline, TIMEOUT_MS)
  if (budget <= 0) throw deadlineExceeded()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), budget)
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
      return callGemini(req, deadline, attempt + 1)
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
  deadline: number,
  quality: 'medium' | 'high',
  attempt = 0,
): Promise<{ image: string; mime: string; model: string }> {
  const key = Deno.env.get('OPENAI_API_KEY')
  if (!key) throw new Error('OPENAI_API_KEY secret is not set')
  const form = new FormData()
  form.append('model', OPENAI_IMAGE_MODEL)
  form.append('image', base64ToBlob(image, mime), 'reference.png')
  form.append('prompt', REDRAW_PROMPT)
  form.append('size', 'auto')
  form.append('quality', quality)

  const budget = remainingMs(deadline, IMAGE_TIMEOUT_MS)
  if (budget <= 0) throw deadlineExceeded()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), budget)
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
      return callOpenAIRedraw(image, mime, deadline, quality, attempt + 1)
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

/**
 * Marks a system prompt as cacheable for Anthropic.
 *
 * A string system prompt cannot carry cache_control, so it becomes a
 * one-element block array. Below Anthropic's minimum cacheable length the
 * breakpoint is simply ignored, which costs nothing.
 */
function cacheable(system: unknown): unknown {
  if (typeof system !== 'string' || !system) return system
  return [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
}

/** Puts a cache breakpoint at the very end of the conversation so far. */
function withTailBreakpoint(messages: unknown): unknown {
  if (!Array.isArray(messages) || !messages.length) return messages
  const out = messages.slice()
  const last = { ...(out[out.length - 1] as Record<string, unknown>) }
  if (!Array.isArray(last.content)) return messages
  const blocks = (last.content as Record<string, unknown>[]).slice()
  blocks[blocks.length - 1] = {
    ...blocks[blocks.length - 1],
    cache_control: { type: 'ephemeral' },
  }
  last.content = blocks
  out[out.length - 1] = last
  return out
}

function usage(raw: Record<string, unknown>) {
  const u = raw.usageMetadata as
    | {
        promptTokenCount?: number
        candidatesTokenCount?: number
        cachedContentTokenCount?: number
      }
    | undefined
  return {
    promptTokens: u?.promptTokenCount ?? null,
    outputTokens: u?.candidatesTokenCount ?? null,
    cachedTokens: u?.cachedContentTokenCount ?? null,
  }
}

interface OpLogEntry {
  op: string
  model: string
  promptTokens: number | null
  outputTokens: number | null
  /** of promptTokens, how many the provider served from its own cache */
  cachedTokens?: number | null
  ms: number
  cost: number
  cached: boolean
}

// The log line must never fail the operator's op — warn and continue.
async function logOp(
  db: SupabaseClient,
  userId: string | null,
  entry: OpLogEntry,
): Promise<void> {
  const { error } = await db.from('ops_log').insert({
    op: entry.op,
    model: entry.model,
    prompt_tokens: entry.promptTokens,
    output_tokens: entry.outputTokens,
    cached_tokens: entry.cachedTokens ?? null,
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
  addToSpendCache(entry.cost)
  console.log(JSON.stringify(entry))
}

// Warm-isolate cache: refresh from the DB at most every 30s and track the
// isolate's own spend in between — the guard stays accurate within cents
// without a per-op roundtrip.
let spendCache: { value: number; at: number } | null = null

// The sum is computed in SQL: selecting the day's rows and adding them up here
// silently under-reported past PostgREST's 1000-row page, which quietly
// disabled the cap on exactly the busy days it exists for.
async function todaysSpend(db: SupabaseClient): Promise<number> {
  if (spendCache && Date.now() - spendCache.at < 30_000) return spendCache.value
  const { data, error } = await db.rpc('ops_spend_today')
  if (error) throw new Error('büdcə yoxlaması alınmadı')
  const value = Number(data ?? 0)
  spendCache = { value, at: Date.now() }
  return value
}

function addToSpendCache(cost: number): void {
  if (spendCache) spendCache.value += cost
}

// Called immediately before a model call, never before a cache lookup.
async function budgetRefusal(db: SupabaseClient): Promise<Response | null> {
  const spend = await todaysSpend(db)
  if (spend < DAILY_BUDGET_USD) return null
  return json(429, {
    kind: 'budget',
    error: `günlük model büdcəsi dolub ($${DAILY_BUDGET_USD}) — sabah davam edin və ya DAILY_BUDGET_USD secret-ini artırın`,
  })
}

interface CacheRow {
  response: Record<string, unknown> | null
  image_path: string | null
  model: string | null
}

async function cacheGet(
  db: SupabaseClient,
  key: string,
): Promise<CacheRow | null> {
  const { data } = await db
    .from('ops_cache')
    .select('response, image_path, model')
    .eq('key', key)
    .maybeSingle()
  return (data as CacheRow | null) ?? null
}

async function cachePut(
  db: SupabaseClient,
  key: string,
  op: string,
  fields: {
    response?: Record<string, unknown>
    image_path?: string
    model?: string
  },
): Promise<void> {
  const { error } = await db.from('ops_cache').insert({
    key,
    op,
    response: fields.response ?? null,
    image_path: fields.image_path ?? null,
    model: fields.model ?? null,
    // Stamped so a stale generation can be swept later; the key already
    // includes the version, so old rows are unreachable, not wrong.
    prompt_version: PROMPT_VERSION,
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

  const started = Date.now()
  const deadline = started + REQUEST_BUDGET_MS

  // Caller-scoped: it answers who is asking and nothing else.
  const caller = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: req.headers.get('Authorization')! } } },
  )
  // Service-scoped: the ledger, the cache and the cached images are written
  // here so a browser session cannot forge a spend row or a cache hit.
  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )
  const { data: isAdmin, error: adminError } = await caller.rpc('is_admin')
  if (adminError) {
    return json(500, { error: 'icazə yoxlaması alınmadı — yenidən cəhd edin' })
  }
  if (!isAdmin) return json(403, { error: 'icazə yoxdur' })
  const { data: userData } = await caller.auth.getUser()
  const userId = userData.user?.id ?? null

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'yanlış sorğu gövdəsi' })
  }
  const op = String(body.op ?? '')

  try {
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
      // Build once and resolve the model from the built request: modelSwap
      // flips the model class, and the key must name the model that actually
      // ran — otherwise changing a *_MODEL secret replays the old model's
      // output from cache forever.
      const request = buildExtract(input)
      const model = GEMINI_MODELS[request.modelKey]
      const key = await sha256Hex(
        JSON.stringify({ v: PROMPT_VERSION, m: model, op, ...input }),
      )
      const hit = await cacheGet(db, key)
      if (hit?.response) {
        const ms = Date.now() - started
        await logOp(db, userId, {
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
      const refusal = await budgetRefusal(db)
      if (refusal) return refusal
      const { parsed, raw } = await callGemini(request, deadline)
      const ms = Date.now() - started
      const u = usage(raw)
      const cost = estGeminiCost(model, u.promptTokens, u.outputTokens)
      await cachePut(db, key, op, {
        response: { wire: parsed, model },
        model,
      })
      await logOp(db, userId, { op, model, ...u, ms, cost, cached: false })
      return json(200, { wire: parsed, model, ms })
    }

    if (op === 'redraw_figure') {
      const bad = badImage(body)
      if (bad) return json(400, { error: bad })
      // The client retries a redraw whose render did not match the original.
      // Without this counter in the key the cache would hand back the exact
      // image that just failed the comparison, so the retry could never differ.
      const attempt = body.attempt === undefined ? 0 : Number(body.attempt)
      if (!Number.isInteger(attempt) || attempt < 0 || attempt > 3) {
        return json(400, { error: 'attempt yanlışdır' })
      }
      // Quality is priced differently, so it is part of the cache key: a
      // medium image must never be served for a high-quality request.
      const quality = body.quality === 'medium' ? 'medium' : 'high'
      const key = await sha256Hex(
        JSON.stringify({
          v: PROMPT_VERSION,
          m: OPENAI_IMAGE_MODEL,
          op,
          image: body.image,
          mime: body.mime,
          quality,
          attempt,
        }),
      )
      const hit = await cacheGet(db, key)
      if (hit?.image_path) {
        const { data: blob } = await db.storage
          .from('question-crops')
          .download(hit.image_path)
        if (blob) {
          const buf = new Uint8Array(await blob.arrayBuffer())
          let bin = ''
          for (const b of buf) bin += String.fromCharCode(b)
          const ms = Date.now() - started
          await logOp(db, userId, {
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
      const refusal = await budgetRefusal(db)
      if (refusal) return refusal
      const out = await callOpenAIRedraw(
        body.image as string,
        body.mime as string,
        deadline,
        quality,
      )
      const ms = Date.now() - started
      const path = `cache/${key}.png`
      const { error: uploadError } = await db.storage
        .from('question-crops')
        .upload(path, base64ToBlob(out.image, out.mime), {
          upsert: true,
          contentType: out.mime,
        })
      if (!uploadError) {
        await cachePut(db, key, op, { image_path: path, model: out.model })
      }
      await logOp(db, userId, {
        op,
        model: out.model,
        promptTokens: null,
        outputTokens: null,
        ms,
        cost: quality === 'medium' ? RATE.imageMedium : RATE.imageFlat,
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
      // Cached like every other model op: the compare runs once per redraw
      // attempt, so without it a re-run of a figure question was never the
      // "nearly free" replay the rest of the pipeline promises.
      const request = buildCompareFigures(
        { image: original.image as string, mime: original.mime as string },
        { image: candidate.image as string, mime: candidate.mime as string },
      )
      const model = GEMINI_MODELS[request.modelKey]
      const key = await sha256Hex(
        JSON.stringify({
          v: PROMPT_VERSION,
          m: model,
          op,
          original: original.image,
          candidate: candidate.image,
        }),
      )
      const hit = await cacheGet(db, key)
      if (hit?.response) {
        const ms = Date.now() - started
        await logOp(db, userId, {
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
      const refusal = await budgetRefusal(db)
      if (refusal) return refusal
      const { parsed, raw } = await callGemini(request, deadline)
      const ms = Date.now() - started
      const u = usage(raw)
      const responseBody = { ...(parsed as Record<string, unknown>), model }
      await cachePut(db, key, op, { response: responseBody, model })
      await logOp(db, userId, {
        op,
        model,
        ...u,
        ms,
        cost: estGeminiCost(model, u.promptTokens, u.outputTokens),
        cached: false,
      })
      return json(200, { ...responseBody, ms })
    }

    if (op === 'suggest_category' || op === 'parse_answer_key') {
      let request: GeminiRequest
      let cachePayload: Record<string, unknown>
      if (op === 'suggest_category') {
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

      // The resolved model belongs in the key: a changed *_MODEL secret must
      // start a new cache generation instead of replaying the old model's
      // answers.
      const model = GEMINI_MODELS[request.modelKey]
      const key = await sha256Hex(
        JSON.stringify({ v: PROMPT_VERSION, m: model, op, ...cachePayload }),
      )
      const hit = await cacheGet(db, key)
      if (hit?.response) {
        const ms = Date.now() - started
        await logOp(db, userId, {
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
      const refusal = await budgetRefusal(db)
      if (refusal) return refusal
      const { parsed, raw } = await callGemini(request, deadline)
      const ms = Date.now() - started
      const u = usage(raw)
      const responseBody = { ...(parsed as Record<string, unknown>), model }
      await cachePut(db, key, op, { response: responseBody, model })
      await logOp(db, userId, {
        op,
        model,
        ...u,
        ms,
        cost: estGeminiCost(model, u.promptTokens, u.outputTokens),
        cached: false,
      })
      return json(200, { ...responseBody, ms })
    }

    // Free, and the only way the browser can know the cap: DAILY_BUDGET_USD is
    // a function secret, so a copy in a VITE_ variable would be a second
    // number that silently disagrees with the one actually enforced.
    if (op === 'budget_status') {
      const spent = await todaysSpend(db)
      return json(200, {
        spent,
        budget: DAILY_BUDGET_USD,
        remaining: Math.max(0, DAILY_BUDGET_USD - spent),
      })
    }

    // One turn of an agent loop. The loop itself lives in the browser — it
    // runs for minutes and this function has 150 seconds — but the key stays
    // here, and so do the ledger and the budget cap, which is the whole reason
    // every model call goes through one door.
    if (op === 'agent_step') {
      const model = String(body.model ?? 'claude-sonnet-5')
      if (!AGENT_MODELS.has(model)) {
        return json(400, { error: `model icazəli deyil: ${model}` })
      }
      if (!Array.isArray(body.messages) || !Array.isArray(body.tools)) {
        return json(400, { error: 'messages və tools massiv olmalıdır' })
      }
      const messages = body.messages as Record<string, unknown>[]
      const tools = body.tools as Record<string, unknown>[]
      // Deliberately NOT cached: every turn carries the whole conversation, so
      // no two turns are ever the same request, and a cache would only store
      // megabytes that can never be read back.
      const refusal = await budgetRefusal(db)
      if (refusal) return refusal

      const budget = remainingMs(deadline, TIMEOUT_MS)
      if (budget <= 0) throw deadlineExceeded()
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), budget)
      const isGemini = model.startsWith('gemini')

      try {
        if (isGemini) {
          const key = Deno.env.get('GEMINI_API_KEY')
          if (!key) return json(500, { error: 'GEMINI_API_KEY secret is not set' })
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                systemInstruction: { parts: [{ text: String(body.system ?? '') }] },
                contents: toGeminiContents(messages),
                tools: toGeminiTools(tools),
                // Every turn of this loop is an action, and finishing is one
                // too — `done` and `give_up` are tools. Left on AUTO the model
                // answers the first turn in prose, the loop sees no call and
                // stops with nothing. ANY makes prose unrepresentable.
                toolConfig: { functionCallingConfig: { mode: 'ANY' } },
                generationConfig: { temperature: 0, maxOutputTokens: 16000 },
              }),
              signal: controller.signal,
            },
          )
          if (!res.ok) {
            const detail = (await res.text()).slice(0, 400)
            // A refused turn left no trace at all, so a loop that died on its
            // second call looked identical to one that made a single call and
            // stopped. It costs nothing to record that it happened.
            await logOp(db, userId, {
              op,
              model: `${model}:${res.status}`,
              promptTokens: null,
              outputTokens: null,
              ms: Date.now() - started,
              cost: 0,
              cached: false,
            })
            if (res.status === 429) {
              return json(429, { error: 'model həddi', detail, kind: 'rate_limit' })
            }
            return json(502, { error: `Gemini ${res.status}`, detail })
          }
          const out = (await res.json()) as Record<string, unknown>
          const candidate = (out.candidates as Record<string, unknown>[] | undefined)?.[0]
          const parts =
            ((candidate?.content as Record<string, unknown> | undefined)?.parts as
              | Record<string, unknown>[]
              | undefined) ?? []
          const u = usage(out)
          const ms = Date.now() - started
          await logOp(db, userId, {
            op,
            model,
            promptTokens: u.promptTokens,
            outputTokens: u.outputTokens,
            // Gemini caches repeated prefixes on its own, without being asked.
            // Whether it actually does so for an agent loop is a question the
            // ledger can answer and guesswork cannot.
            cachedTokens: u.cachedTokens,
            ms,
            cost: estGeminiCost(model, u.promptTokens, u.outputTokens),
            cached: false,
          })
          return json(200, {
            content: fromGeminiParts(parts),
            stop_reason: candidate?.finishReason ?? null,
            usage: out.usageMetadata ?? null,
            ms,
          })
        }

        const key = Deno.env.get('ANTHROPIC_API_KEY')
        if (!key) return json(500, { error: 'ANTHROPIC_API_KEY secret is not set' })
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model,
            max_tokens: 16000,
            output_config: { effort: 'high' },
            // Two breakpoints. The first freezes the standard and the tool
            // definitions — identical on every turn of every question. The
            // second sits at the end of the conversation so far, so the next
            // turn re-reads all of it at a tenth of the price instead of
            // paying full rate for a transcript that only grew at one end.
            system: cacheable(body.system),
            tools,
            messages: withTailBreakpoint(messages),
          }),
          signal: controller.signal,
        })
        if (!res.ok) {
          const detail = (await res.text()).slice(0, 400)
          if (res.status === 429) {
            return json(429, { error: 'model həddi', detail, kind: 'rate_limit' })
          }
          return json(502, { error: `Anthropic ${res.status}`, detail })
        }
        const out = (await res.json()) as Record<string, unknown>
        const u = (out.usage ?? {}) as {
          input_tokens?: number
          output_tokens?: number
          cache_creation_input_tokens?: number
          cache_read_input_tokens?: number
        }
        const ms = Date.now() - started
        // Anthropic reports cached tokens OUTSIDE input_tokens, and prices
        // them differently: a write costs 1.25x the input rate, a read 0.1x.
        // Charging them all at the input rate would make caching look like it
        // changed nothing, which is the one thing this ledger exists to tell us.
        const wrote = u.cache_creation_input_tokens ?? 0
        const read = u.cache_read_input_tokens ?? 0
        const fresh = u.input_tokens ?? null
        await logOp(db, userId, {
          op,
          model,
          promptTokens: (fresh ?? 0) + wrote + read,
          outputTokens: u.output_tokens ?? null,
          cachedTokens: read,
          ms,
          cost:
            estAnthropicCost(model, fresh, u.output_tokens ?? null) +
            estAnthropicCost(model, Math.round(wrote * 1.25 + read * 0.1), 0),
          cached: false,
        })
        return json(200, {
          content: out.content,
          stop_reason: out.stop_reason,
          usage: out.usage,
          ms,
        })
      } finally {
        clearTimeout(timer)
      }
    }

    if (op === 'option_boxes') {
      const bad = badImage(body)
      if (bad) return json(400, { error: bad })
      const request = buildOptionBoxes({
        image: body.image as string,
        mime: body.mime as string,
      })
      const model = GEMINI_MODELS[request.modelKey]
      const key = await sha256Hex(
        JSON.stringify({ v: PROMPT_VERSION, m: model, op, image: body.image, mime: body.mime }),
      )
      const hit = await cacheGet(db, key)
      if (hit?.response) {
        const ms = Date.now() - started
        await logOp(db, userId, { op, model: hit.model ?? 'cache', promptTokens: null, outputTokens: null, ms, cost: 0, cached: true })
        return json(200, { ...hit.response, ms, cached: true })
      }
      const refusal = await budgetRefusal(db)
      if (refusal) return refusal
      const { parsed, raw } = await callGemini(request, deadline)
      const out = parsed as Record<string, unknown>
      // Same rule as the page detector: a box with any non-finite number is
      // dropped whole rather than forwarded as NaN and failing further in.
      const boxes = (Array.isArray(out.options) ? (out.options as Record<string, unknown>[]) : [])
        .map((o) => {
          const rawBox = Array.isArray(o.box) ? (o.box as unknown[]) : []
          if (rawBox.length < 4) return null
          const box = rawBox.slice(0, 4).map(Number)
          const label = String(o.label ?? '')
          if (!'ABCDE'.includes(label) || label.length !== 1) return null
          if (box.some((n) => !Number.isFinite(n))) return null
          return { label, box }
        })
        .filter((b) => b !== null)
      const responseBody = { options: boxes }
      const ms = Date.now() - started
      await cachePut(db, key, op, { response: responseBody, model })
      const u = usage(raw)
      await logOp(db, userId, {
        op, model,
        promptTokens: u.promptTokens,
        outputTokens: u.outputTokens,
        ms,
        cost: estimateCost(model, u.promptTokens, u.outputTokens),
        cached: false,
      })
      return json(200, { ...responseBody, ms })
    }

    if (op === 'detect_questions') {
      const bad = badImage(body)
      if (bad) return json(400, { error: bad })
      const request = buildDetectQuestions({
        image: body.image as string,
        mime: body.mime as string,
      })
      const model = GEMINI_MODELS[request.modelKey]
      const key = await sha256Hex(
        JSON.stringify({
          v: PROMPT_VERSION,
          m: model,
          op,
          image: body.image,
          mime: body.mime,
        }),
      )
      // Segmentation is re-run whenever an operator reopens a book, so the
      // cache is what keeps a second pass over the same pages free.
      const hit = await cacheGet(db, key)
      if (hit?.response) {
        const ms = Date.now() - started
        await logOp(db, userId, {
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
      const refusal = await budgetRefusal(db)
      if (refusal) return refusal
      const { parsed, raw } = await callGemini(request, deadline)
      const out = parsed as Record<string, unknown>

      // Symmetric sanitization: an anchor with ANY non-finite numeric field is
      // dropped whole, never forwarded as NaN/null to break the client schema.
      // Per-anchor column is not forwarded at all — the client reassigns
      // columns from box geometry anyway.
      const rawQuestions = Array.isArray(out.questions)
        ? (out.questions as Record<string, unknown>[])
        : []
      const anchors = rawQuestions
        .map((q) => {
          const rawBox = Array.isArray(q.box) ? (q.box as unknown[]) : []
          if (rawBox.length < 4) return null
          const box = rawBox.slice(0, 4).map(Number)
          const number = Number(q.number)
          if (!Number.isFinite(number) || box.some((n) => !Number.isFinite(n))) {
            return null
          }
          return { number, box }
        })
        .filter((a) => a !== null)
      const rawTestNo = Number(out.test_no)
      const rawColumns = Number(out.columns)
      const responseBody = {
        // The page has one or two columns; anything else is a misread, and the
        // segmenter would flatten it to the same range anyway.
        columns: Number.isFinite(rawColumns)
          ? Math.min(2, Math.max(1, Math.round(rawColumns)))
          : 1,
        testNo:
          out.test_no != null && Number.isFinite(rawTestNo) ? rawTestNo : undefined,
        anchors,
      }

      const ms = Date.now() - started
      const u = usage(raw)
      await cachePut(db, key, op, { response: responseBody, model })
      await logOp(db, userId, {
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
    // A provider rate limit survived the in-function retry: tell the client
    // what it is, so it can pace itself instead of burning the queue on
    // errors it could have waited out.
    if (/\b429\b|rate limit|quota/i.test(message)) {
      return json(429, {
        kind: 'rate_limit',
        error: 'model sorğu limitinə çatdı — bir az yavaşlayırıq',
        detail: message.slice(0, 300),
      })
    }
    return json(502, {
      error: isTimeout ? 'model cavabı vaxt aşımına uğradı' : 'model çağırışı alınmadı',
      detail: message.slice(0, 300),
    })
  }
})

// The INTERACTIVE model calls, behind one admin-gated door.
//
// This function is no longer the pipeline. Batch work — every question the
// queue holds — runs in `worker/`, which talks to the Anthropic Batches API at
// half price and is not bounded by an Edge Function's wall clock. What is left
// here is the handful of calls a person triggers and waits for:
//
//   extract           re-run ONE question from the review screen
//   parse_answer_key  read a printed key page during import
//   detect_questions  find the questions on a scanned page during import
//   budget_status     free; the only way the browser learns the cap
//
// Four ops are gone, and none of them for tidiness. `option_boxes` existed only
// because Gemini ignored the per-option `box` field in the extraction schema
// (schemas.ts records that diagnosis); Anthropic fills it in, so asking twice
// buys nothing. `compare_figures` belonged to the browser's render-and-compare
// loop, which becomes the worker's verification wave. `suggest_category` was
// folded into extraction — the model has read the question by the time it could
// answer, so a second call re-sends the crop to learn nothing. And
// `redraw_figure` was the last image-generation call and the last non-Anthropic
// one: with no caller and its provider key removed, keeping it would have kept
// a path that could only fail. Git history has all four if a need returns.
//
// So this is Anthropic only, end to end, and there is no lane anywhere that
// generates an image.
//
// A question's answer is never produced here. It comes from the printed key or
// from the reviewer, so there is deliberately no solve op.
//
// Cost controls are unchanged in shape: every call is logged to `ops_log` with
// an estimated cost and refused once the day passes DAILY_BUDGET_USD, and
// deterministic ops are cached in `ops_cache`. The budget is checked
// immediately before each model call and never before a cache lookup — a cache
// hit costs nothing and must keep serving on a capped day, or a capped day
// turns cached questions into permanent failures.
//
// Two Supabase clients on purpose: the caller's JWT answers "is this an
// admin?", and only the service role writes the ledger and the cache.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import {
  buildAnthropicExtract,
  type ModelLane,
} from '@/core/extract/request-anthropic'
import { EMIT_QUESTION_TOOL_NAME } from '@/core/extract/tool-schema'
import {
  buildDetectQuestions,
  buildParseAnswerKey,
  type GeminiRequest,
} from '@/core/extract/request-gemini'
import { estimateCost, promptTokens, samplingFor, usageFrom } from '@/core/models'
import { PROMPT_VERSION, promptFingerprint } from '@/core/extract/prompts'

// Ids are configuration, exactly as in the worker: which model serves a lane is
// a question an eval settles, not a constant.
const MODELS: Record<ModelLane | 'utility', string> = {
  text: Deno.env.get('ANTHROPIC_TEXT_MODEL') ?? 'claude-haiku-4-5',
  figure: Deno.env.get('ANTHROPIC_FIGURE_MODEL') ?? 'claude-sonnet-5',
  // Answer keys, page detection and category filing: reading tasks with no
  // figure to recreate, so the cheap tier is the right one.
  utility: Deno.env.get('ANTHROPIC_UTILITY_MODEL') ?? 'claude-haiku-4-5',
}
const DAILY_BUDGET_USD = Number(Deno.env.get('DAILY_BUDGET_USD') ?? '20')

const TIMEOUT_MS = 120_000
// The whole request's wall clock. Per-call timeouts alone were not enough: a
// retry used to arm a full fresh timeout, so a slow call plus its retry could
// outlive the function and be killed by the platform.
const REQUEST_BUDGET_MS = 145_000
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

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(input),
  )
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// Every attempt is armed with what is LEFT of the request's wall clock, so a
// retry can never push the function past the platform's own limit.
function remainingMs(deadline: number, perCallTimeout: number): number {
  return Math.max(0, Math.min(perCallTimeout, deadline - Date.now()))
}

function deadlineExceeded(): DOMException {
  return new DOMException('request deadline exceeded', 'AbortError')
}

interface AnthropicAnswer {
  /** The forced tool's input, when the model called it. */
  tool: Record<string, unknown> | null
  /** Free text, for the ops that ask for JSON rather than a tool. */
  text: string
  usage: {
    input_tokens?: number
    output_tokens?: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  }
}

/**
 * Raw fetch rather than the SDK.
 *
 * The request body is already assembled by `@/core/extract` — the same bytes
 * the worker sends — so an SDK here would only be a second way to build
 * something that is already built, plus an npm import to resolve at cold start.
 */
async function callAnthropic(
  model: string,
  params: Record<string, unknown>,
  deadline: number,
  attempt = 0,
): Promise<AnthropicAnswer> {
  const key = Deno.env.get('ANTHROPIC_API_KEY')
  if (!key) throw new Error('ANTHROPIC_API_KEY secret is not set')
  const budget = remainingMs(deadline, TIMEOUT_MS)
  if (budget <= 0) throw deadlineExceeded()

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), budget)
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      // Sampling is applied here, where the model id is known: the builders
      // resolve a lane, and whether a lane's model accepts `temperature` is a
      // property of the id. Sending it to a model that removed it is a 400.
      body: JSON.stringify({ model, ...samplingFor(model), ...params }),
      signal: controller.signal,
    })
    if ((res.status === 429 || res.status >= 500) && attempt < 1) {
      void res.body?.cancel().catch(() => {})
      await new Promise((r) => setTimeout(r, 2000))
      return callAnthropic(model, params, deadline, attempt + 1)
    }
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 400)
      throw new Error(`Anthropic ${res.status}: ${detail}`)
    }
    const out = (await res.json()) as {
      content?: { type: string; name?: string; text?: string; input?: unknown }[]
      usage?: AnthropicAnswer['usage']
      stop_reason?: string
    }
    const blocks = out.content ?? []
    const tool = blocks.find(
      (b) => b.type === 'tool_use' && b.name === EMIT_QUESTION_TOOL_NAME,
    )
    return {
      tool: (tool?.input as Record<string, unknown> | undefined) ?? null,
      text: blocks
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join(''),
      usage: out.usage ?? {},
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The ops that still speak in JSON rather than through a tool.
 *
 * `parse_answer_key` and `detect_questions` were built against Gemini's
 * responseSchema, which constrained the output. Anthropic has
 * no equivalent for a plain message, so the schema is described in the prompt
 * and the answer is parsed here — with the first `{`..`}` extracted, because a
 * model asked for JSON will occasionally wrap it in prose.
 */
function parseJsonAnswer(text: string): unknown {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start === -1 || end <= start) {
      throw new Error(`model JSON qaytarmadı: ${trimmed.slice(0, 200)}`)
    }
    return JSON.parse(trimmed.slice(start, end + 1))
  }
}

/**
 * A Gemini request body, re-expressed as an Anthropic one.
 *
 * The three utility ops keep their Gemini builders because their PROMPTS and
 * SCHEMAS are the asset and are shared with the eval fixtures. Rather than fork
 * them, the parts are lifted back out — the prompt text and the images — and
 * the response schema is appended to the prompt so the model still knows the
 * shape it owes. When these ops get tool definitions of their own, this goes.
 */
function geminiToAnthropic(request: GeminiRequest): Record<string, unknown> {
  const body = request.body as {
    contents: { parts: { text?: string; inlineData?: { mimeType: string; data: string } }[] }[]
    generationConfig?: { responseSchema?: unknown }
  }
  const parts = body.contents[0]?.parts ?? []
  const content: Record<string, unknown>[] = []
  for (const part of parts) {
    if (part.inlineData) {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: part.inlineData.mimeType,
          data: part.inlineData.data,
        },
      })
    } else if (part.text) {
      content.push({ type: 'text', text: part.text })
    }
  }
  const schema = body.generationConfig?.responseSchema
  if (schema) {
    content.push({
      type: 'text',
      text:
        'Cavabı YALNIZ bu JSON sxeminə uyğun JSON kimi qaytar. ' +
        'Heç bir izahat, heç bir markdown çərçivəsi əlavə etmə.\n' +
        JSON.stringify(schema),
    })
  }
  return { max_tokens: 8192, messages: [{ role: 'user', content }] }
}

interface LogEntry {
  op: string
  model: string
  promptTokens: number | null
  outputTokens: number | null
  cachedTokens?: number | null
  ms: number
  cost: number
  cached: boolean
}

async function logOp(
  db: SupabaseClient,
  userId: string | null,
  entry: LogEntry,
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
  if (error) console.warn('ops_log insert failed', error.message)
}

let spendCache = { at: 0, value: 0 }

async function todaysSpend(db: SupabaseClient): Promise<number> {
  if (Date.now() - spendCache.at < 30_000) return spendCache.value
  const { data, error } = await db.rpc('ops_spend_today')
  if (error) throw new Error(`spend oxunmadı: ${error.message}`)
  spendCache = { at: Date.now(), value: Number(data ?? 0) }
  return spendCache.value
}

function addToSpendCache(cost: number): void {
  spendCache = { at: spendCache.at, value: spendCache.value + cost }
}

/** Called immediately before a model call, never before a cache lookup. */
async function budgetRefusal(db: SupabaseClient): Promise<Response | null> {
  const spent = await todaysSpend(db)
  if (spent < DAILY_BUDGET_USD) return null
  return json(429, {
    kind: 'budget',
    error: `günlük model büdcəsi dolub ($${DAILY_BUDGET_USD}) — sabah davam edin və ya DAILY_BUDGET_USD secret-ini artırın`,
  })
}

interface CacheHit {
  response: Record<string, unknown> | null
  image_path: string | null
  model: string | null
}

async function cacheGet(
  db: SupabaseClient,
  key: string,
): Promise<CacheHit | null> {
  const { data } = await db
    .from('ops_cache')
    .select('response, image_path, model')
    .eq('key', key)
    .maybeSingle()
  return (data as CacheHit | null) ?? null
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
    prompt_version: PROMPT_VERSION,
  })
  if (error && !error.message.includes('duplicate')) {
    console.warn('ops_cache insert failed', error.message)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' })

  const started = Date.now()
  const deadline = started + REQUEST_BUDGET_MS

  const caller = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: req.headers.get('Authorization')! } } },
  )
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
    // One question, re-read on demand. The SAME request the worker submits in
    // bulk — same prompt, same tool, same schema — so an operator re-running a
    // row from the review screen gets the batch lane's answer, not a second
    // implementation's.
    if (op === 'extract') {
      const bad = badImage(body)
      if (bad) return json(400, { error: bad })

      const request = buildAnthropicExtract({
        image: body.image as string,
        mime: body.mime as 'image/png' | 'image/jpeg',
        hasFigure: body.hasFigure === true,
        textLayerHint:
          typeof body.textLayerHint === 'string' ? body.textLayerHint : undefined,
        testNo: typeof body.testNo === 'number' ? body.testNo : undefined,
        expectedNumber:
          typeof body.expectedNumber === 'number' ? body.expectedNumber : undefined,
        categories: Array.isArray(body.categories)
          ? (body.categories as { id: number; name: string; parentId: number | null }[])
          : [],
      })
      const model = MODELS[request.lane]
      const key = await sha256Hex(
        JSON.stringify({
          v: PROMPT_VERSION,
          // See promptFingerprint: the version is bumped by hand and was once
          // forgotten, which made the cache serve a pre-edit answer.
          p: promptFingerprint(),
          m: model,
          op,
          image: body.image,
          mime: body.mime,
          hasFigure: body.hasFigure === true,
          hint: body.textLayerHint ?? null,
          testNo: body.testNo ?? null,
          expectedNumber: body.expectedNumber ?? null,
          categoryIds: Array.isArray(body.categories)
            ? (body.categories as { id: number }[]).map((c) => c.id)
            : [],
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

      const answer = await callAnthropic(model, request.params, deadline)
      if (!answer.tool) {
        throw new Error(
          `model ${EMIT_QUESTION_TOOL_NAME} çağırmadı — cavab: ${answer.text.slice(0, 200)}`,
        )
      }
      const ms = Date.now() - started
      const usage = usageFrom(answer.usage)
      const cost = estimateCost(model, usage)
      const responseBody = { wire: answer.tool, model }
      await cachePut(db, key, op, { response: responseBody, model })
      await logOp(db, userId, {
        op,
        model,
        promptTokens: promptTokens(usage),
        outputTokens: usage.output,
        cachedTokens: usage.cacheRead,
        ms,
        cost,
        cached: false,
      })
      addToSpendCache(cost)
      return json(200, { ...responseBody, ms })
    }

    // The two reading ops: a printed answer-key page, and where the questions
    // sit on a scan. Same cache/budget/ledger contract, one shared body because
    // they differ only in which prompt they are handed.
    if (op === 'parse_answer_key' || op === 'detect_questions') {
      const bad = badImage(body)
      if (bad) return json(400, { error: bad })
      const input = { image: body.image as string, mime: body.mime as string }
      const request: GeminiRequest =
        op === 'parse_answer_key'
          ? buildParseAnswerKey(input)
          : buildDetectQuestions(input)
      const cachePayload: Record<string, unknown> = input

      const model = MODELS.utility
      const key = await sha256Hex(
        JSON.stringify({ v: PROMPT_VERSION, p: promptFingerprint(), m: model, op, ...cachePayload }),
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

      const answer = await callAnthropic(
        model,
        geminiToAnthropic(request),
        deadline,
      )
      const parsed = parseJsonAnswer(answer.text) as Record<string, unknown>
      const ms = Date.now() - started
      const usage = usageFrom(answer.usage)
      const cost = estimateCost(model, usage)
      const responseBody = { ...parsed, model }
      await cachePut(db, key, op, { response: responseBody, model })
      await logOp(db, userId, {
        op,
        model,
        promptTokens: promptTokens(usage),
        outputTokens: usage.output,
        cachedTokens: usage.cacheRead,
        ms,
        cost,
        cached: false,
      })
      addToSpendCache(cost)
      return json(200, { ...responseBody, ms })
    }

    // Free, and the only way the browser can know the cap: DAILY_BUDGET_USD is
    // a function secret, so a copy in a VITE_ variable would be a second number
    // that silently disagrees with the one actually enforced.
    if (op === 'budget_status') {
      const spent = await todaysSpend(db)
      return json(200, {
        spent,
        budget: DAILY_BUDGET_USD,
        remaining: Math.max(0, DAILY_BUDGET_USD - spent),
      })
    }

    return json(400, { error: 'naməlum op' })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/\b429\b|rate limit|quota|overloaded/i.test(message)) {
      return json(429, { kind: 'rate_limit', error: 'model həddi aşıldı', detail: message })
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      return json(502, { error: 'model cavabı vaxt aşımına uğradı' })
    }
    console.error('question-ops failed', message)
    return json(502, { error: 'model çağırışı alınmadı', detail: message })
  }
})

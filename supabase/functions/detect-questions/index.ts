// Vision detection for scanned question-bank pages. The browser sends one
// page as JPEG; Gemini returns per-question bounding boxes (normalized
// 0–1000), a column count, and any printed test number / answer key.
//
// This function exists so the Gemini key lives in function secrets and never
// reaches the client bundle — the exam MVP's central mistake. The key travels
// in the x-goog-api-key header, never in a URL.

import { createClient } from 'npm:@supabase/supabase-js@2'

const GEMINI_MODEL = Deno.env.get('GEMINI_DETECT_MODEL') ?? 'gemini-3.5-flash'
const TIMEOUT_MS = 60_000
const MAX_BASE64_LENGTH = 8_000_000 // ~6MB image — one page is ~300KB

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  // One preflight per session instead of per page (browsers cap the value).
  'Access-Control-Max-Age': '86400',
}

const DETECT_SCHEMA = {
  type: 'object',
  properties: {
    columns: {
      type: 'integer',
      description: 'number of question columns on the page (1 or 2)',
    },
    test_no: {
      type: 'integer',
      description: 'test/deneme number if a banner shows one',
    },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          number: {
            type: 'integer',
            description: 'the printed question number',
          },
          column: {
            type: 'integer',
            description:
              '0 = left column, 1 = right column, 0 if single column',
          },
          box: {
            type: 'array',
            items: { type: 'number' },
            description:
              '[ymin, xmin, ymax, xmax] normalized 0-1000, covering the WHOLE question (number through last option/figure)',
          },
        },
        required: ['number', 'column', 'box'],
      },
    },
  },
  required: ['columns', 'questions'],
}

const DETECT_PROMPT = `Bu, imtahan sual bankının BİR səhifəsidir. Vəzifən: HƏR sualın yerini tapmaq.

Qaydalar:
- Səhifə 1 və ya 2 sütunlu ola bilər. İki sütunlu səhifədə sol sütun column=0, sağ sütun column=1.
- Hər sual üçün box = [ymin, xmin, ymax, xmax], hər biri 0–1000 normallaşdırılmış (0 = yuxarı/sol, 1000 = aşağı/sağ).
  box BÜTÜN sualı əhatə etməlidir: sual nömrəsindən başlayıb şəkil/cədvəl və BÜTÜN cavab variantları (A–E) daxil olmaqla ən aşağı sətrə qədər.
- Sual nömrəsi rəqəmlə (1, 2, ...), rəngli disk içində rəqəmlə (❶) və ya nöqtəli (1.) ola bilər — hamısını tap.
- Səhifə başlığında "Test N" / "N. Deneme" varsa test_no-da qaytar.
- Watermark, dekorativ şəkillər (məs. qüllə silueti) və səhifə nömrəsini SUAL sayma.
- Sualları nömrə sırası ilə qaytar.`

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

async function callGemini(base64: string, mime: string): Promise<Response> {
  const key = Deno.env.get('GEMINI_API_KEY')
  if (!key) throw new Error('GEMINI_API_KEY secret is not set')

  const body = JSON.stringify({
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: mime, data: base64 } },
          { text: DETECT_PROMPT },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: DETECT_SCHEMA,
    },
  })

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`
  const attempt = () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body,
      signal: controller.signal,
    }).finally(() => clearTimeout(timer))
  }

  let res = await attempt()
  // One bounded retry on rate-limit / transient server errors. The abandoned
  // response's body is cancelled so its fetch resource is released now, not
  // at GC time.
  if (res.status === 429 || res.status >= 500) {
    void res.body?.cancel().catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 2000))
    res = await attempt()
  }
  return res
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') return json(405, { error: 'POST only' })

  // The platform verifies the JWT; this verifies the allowlist. A signed-in
  // non-admin must not be able to spend the Gemini budget.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    {
      global: { headers: { Authorization: req.headers.get('Authorization')! } },
    },
  )
  const { data: isAdmin, error: adminError } = await supabase.rpc('is_admin')
  // Fail closed, but keep a transient RPC failure distinguishable from a real
  // authorization denial — the operator sees "retry", not "access revoked".
  if (adminError) {
    return json(500, { error: 'icazə yoxlaması alınmadı — yenidən cəhd edin' })
  }
  if (!isAdmin) {
    return json(403, { error: 'admin deyil' })
  }

  let payload: { image?: string; mime?: string }
  try {
    payload = await req.json()
  } catch {
    return json(400, { error: 'JSON body gözlənilir' })
  }
  const base64 = payload.image ?? ''
  const mime = payload.mime ?? 'image/jpeg'
  if (!base64 || base64.length > MAX_BASE64_LENGTH) {
    return json(400, { error: 'image boş və ya çox böyükdür' })
  }
  if (mime !== 'image/jpeg' && mime !== 'image/png') {
    return json(400, { error: 'yalnız JPEG/PNG' })
  }

  const t0 = Date.now()
  try {
    const res = await callGemini(base64, mime)
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300)
      return json(502, { error: `Gemini ${res.status}`, detail })
    }
    const result = await res.json()
    const finishReason = result?.candidates?.[0]?.finishReason
    const blockReason = result?.promptFeedback?.blockReason
    const text = result?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) {
      return json(502, {
        error: 'Gemini boş cavab qaytardı',
        detail: blockReason ?? finishReason ?? null,
      })
    }

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(text)
    } catch {
      return json(502, {
        error: 'Gemini cavabı JSON deyil',
        detail: finishReason ?? null, // MAX_TOKENS truncation lands here
      })
    }

    // Symmetric sanitization: an anchor with ANY non-finite numeric field is
    // dropped whole, never forwarded as NaN/null to break the client schema.
    // Per-anchor column is not forwarded at all — the client reassigns columns
    // from box geometry anyway.
    const rawQuestions = Array.isArray(parsed.questions)
      ? (parsed.questions as Record<string, unknown>[])
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

    const rawTestNo = Number(parsed.test_no)
    const columns = Number(parsed.columns)
    const usage = result?.usageMetadata ?? {}
    // One structured line per request so the function's dashboard logs carry
    // the Gemini-side signal (model, latency, tokens, outcome).
    console.log(
      JSON.stringify({
        model: GEMINI_MODEL,
        ms: Date.now() - t0,
        finishReason: finishReason ?? null,
        promptTokens: usage.promptTokenCount ?? null,
        outputTokens: usage.candidatesTokenCount ?? null,
        anchors: anchors.length,
      }),
    )

    return json(200, {
      columns: Number.isFinite(columns) ? columns : 1,
      testNo:
        parsed.test_no != null && Number.isFinite(rawTestNo)
          ? rawTestNo
          : undefined,
      anchors,
    })
  } catch (error) {
    const message =
      error instanceof Error && error.name === 'AbortError'
        ? 'Gemini cavabı vaxt aşımına uğradı'
        : error instanceof Error
          ? error.message
          : 'naməlum xəta'
    return json(502, { error: message })
  }
})

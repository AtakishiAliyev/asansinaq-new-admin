// Validates the extraction request against the real Anthropic API.
//
//   npm run smoke:request
//
// MANUAL AND OPERATOR-RUN, like smoke:queue, and for the same reason: it needs
// the network and a key, while eval is free, offline and safe on every edit.
//
// Two modes.
//
//   (default)  countTokens only. FREE, and validates a lot: the request is
//              accepted, the blocks are well formed, the prefix is the right
//              size. It is not billed and generates nothing.
//
//   --live     additionally sends ONE REAL request per lane with a real crop.
//              Costs about a cent. This is the only check that proves the
//              request can actually be EXECUTED.
//
// Run --live before any batch. countTokens accepted a request that every single
// batch item then rejected, twice over: `temperature` is refused by the current
// models, and strict tool use compiles the schema into a grammar and caps it at
// 24 optional parameters where ours has 63. Neither is visible to a token
// count, because neither sampling nor grammar compilation happens there.
//
// It exercises BOTH lanes deliberately. The two failures above were
// lane-specific — the figure lane died on temperature, the text lane on the
// schema — so a check that proved one lane worked would have reported success
// while half the batch was still doomed.
//
// RUN IT AFTER ANY CHANGE to the tool schema, the prompts, or the block order
// in request-anthropic.ts. Two failures it catches that offline assertions
// cannot:
//
//   - a schema the API rejects. `strict` tool use has requirements the eval
//     can only guess at, and the alternative to finding out here is finding
//     out when a paid batch of several hundred questions errors on submit.
//   - a prefix that has stopped being most of the request. The economics of
//     the batch lane assume the cacheable prefix dwarfs the per-question part;
//     if that ratio inverts, caching quietly stops being worth anything and
//     nothing else says so.
//
// It reports the split rather than asserting a threshold. The number moves with
// the prompt and the crop, and a gate on it would be a gate on a judgement.
import { readFileSync } from 'node:fs'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { buildAnthropicExtract } from '../src/core/extract/request-anthropic.ts'
import { samplingFor } from '../src/core/models.ts'
import type { Database } from '../src/types/database.ts'

// A 1x1 PNG. The point is to measure everything EXCEPT the crop: a real crop
// adds roughly 1,200-1,600 tokens, and mixing that in would hide the prefix.
const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function readEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {}
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return out
  }
  for (const line of raw.split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (m?.[1]) out[m[1]] = (m[2] ?? '').replace(/^["']|["']$/g, '')
  }
  return out
}

const env = { ...readEnvFile('.env'), ...process.env }
const apiKey = env.ANTHROPIC_API_KEY
if (!apiKey) {
  console.error('ANTHROPIC_API_KEY is required (it belongs in the gitignored .env).')
  process.exit(2)
}

// Not the worker's configured model: this validates the request SHAPE, and the
// shape is identical on every tier. Pinning the cheapest keeps the check
// meaningful even while MODEL_TEXT/MODEL_FIGURE are being tuned.
const MODEL = 'claude-haiku-4-5'

const client = new Anthropic({ apiKey })

const { lane, params } = buildAnthropicExtract({
  image: PNG_1X1,
  mime: 'image/png',
  hasFigure: true,
  textLayerHint: '12. x + 1 = 3',
  expectedNumber: 12,
  testNo: 3,
  categories: [
    { id: 1, name: 'Cəbr', parentId: null },
    { id: 2, name: 'Tənliklər', parentId: 1 },
  ],
})

const content = params.messages[0]?.content
if (!Array.isArray(content)) {
  console.error('the builder no longer produces a block array')
  process.exit(1)
}

let full: Anthropic.MessageTokensCount
try {
  full = await client.messages.countTokens({
    model: MODEL,
    system: params.system,
    messages: params.messages,
    tools: params.tools,
    tool_choice: params.tool_choice,
  })
} catch (error) {
  const err = error as { status?: number; message?: string }
  console.error(
    `REJECTED by the API${err.status ? ` (${err.status})` : ''}: ${err.message ?? String(error)}`,
  )
  console.error('\nThe request would fail on submit. Do not run a batch until this passes.')
  process.exit(1)
}

// Everything below the last breakpoint — the crop and this question's hint.
const perQuestion = await client.messages.countTokens({
  model: MODEL,
  messages: [{ role: 'user', content: content.slice(1) }],
})

const prefix = full.input_tokens - perQuestion.input_tokens
const share = (prefix / full.input_tokens) * 100

console.log(`countTokens ACCEPTED.  lane=${lane}  model=${MODEL}\n`)
console.log(`  full request      ${String(full.input_tokens).padStart(6)} tokens`)
console.log(`  cacheable prefix  ${String(prefix).padStart(6)} tokens   ${share.toFixed(1)}%`)
console.log(`  per question      ${String(perQuestion.input_tokens).padStart(6)} tokens   (1x1 crop + hint)`)

if (!process.argv.includes('--live')) {
  console.log(
    '\nA real crop adds roughly 1,200-1,600 tokens to the per-question line,\n' +
      'so expect the prefix share to land near 80% in production.\n\n' +
      'This did NOT prove the request can be executed — countTokens does not\n' +
      'compile the tool grammar or validate sampling parameters, and has\n' +
      'accepted requests that every batch item then rejected. Run with --live\n' +
      'before submitting a batch.',
  )
  process.exit(0)
}

// ---- --live: one real call per lane, against a real crop ----

const supabaseUrl = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !serviceKey) {
  console.error('\n--live needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to fetch a real crop.')
  process.exit(2)
}

const db = createClient<Database>(supabaseUrl, serviceKey, {
  auth: { persistSession: false },
})
const { data: rows } = await db
  .from('questions')
  .select('id, crop_path, crop_mime, text_layer, q_no, test_no')
  .order('id')
  .limit(1)
const sample = rows?.[0]
if (!sample) {
  console.error('\n--live needs at least one question row to borrow a crop from.')
  process.exit(2)
}
const { data: blob } = await db.storage.from('question-crops').download(sample.crop_path)
if (!blob) {
  console.error(`\ncould not download ${sample.crop_path}`)
  process.exit(2)
}
const cropImage = Buffer.from(await blob.arrayBuffer()).toString('base64')
const cropMime = sample.crop_mime === 'image/jpeg' ? 'image/jpeg' : 'image/png'

console.log(`\n--live: sending one real request per lane, using crop ${sample.crop_path}`)

let liveFailures = 0
for (const [laneName, model] of [
  ['text', env.MODEL_TEXT ?? 'claude-haiku-4-5'],
  ['figure', env.MODEL_FIGURE ?? 'claude-sonnet-5'],
] as const) {
  const request = buildAnthropicExtract({
    image: cropImage,
    mime: cropMime,
    hasFigure: laneName === 'figure',
    textLayerHint: sample.text_layer ?? undefined,
    expectedNumber: sample.q_no,
    testNo: sample.test_no ?? undefined,
    categories: [{ id: 1, name: 'Cəbr', parentId: null }],
  })
  try {
    // samplingFor comes from core, the same module the worker and the Edge
    // Function use, so this cannot pass on a shape they would not send.
    const message = await client.messages.create({
      model,
      ...samplingFor(model),
      ...request.params,
    })
    const tool = message.content.find((b) => b.type === 'tool_use')
    const u = message.usage
    console.log(
      `  ${laneName.padEnd(6)} ${model.padEnd(20)} OK  ` +
        `stop=${message.stop_reason} tool=${tool ? 'yes' : 'NO'} ` +
        `in=${u.input_tokens} cache_read=${u.cache_read_input_tokens ?? 0} out=${u.output_tokens}`,
    )
    if (!tool) {
      console.log('         ^ the tool was forced but not called — nothing to write')
      liveFailures++
    }
  } catch (error) {
    const err = error as { status?: number; message?: string }
    console.log(`  ${laneName.padEnd(6)} ${model.padEnd(20)} FAILED ${err.status ?? ''}`)
    console.log(`         ${err.message ?? String(error)}`)
    liveFailures++
  }
}

if (liveFailures) {
  console.error(`\n${liveFailures} lane(s) failed. Do NOT submit a batch.`)
  process.exit(1)
}
console.log('\nBoth lanes executed a real request. Safe to submit a batch.')

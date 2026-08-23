// Validates the extraction request against the real Anthropic API.
//
//   npm run smoke:request
//
// MANUAL AND OPERATOR-RUN, like smoke:queue, and for the same reason: it needs
// the network and a key, while eval is free, offline and safe on every edit.
//
// FREE. It uses countTokens, which validates the whole request body server-side
// — tool schema, tool_choice, cache_control placement, image block — and is not
// billed. Nothing here submits a batch or generates a token.
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
import { buildAnthropicExtract } from '../src/core/extract/request-anthropic.ts'

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

console.log(`ACCEPTED by the API.  lane=${lane}  model=${MODEL}\n`)
console.log(`  full request      ${String(full.input_tokens).padStart(6)} tokens`)
console.log(`  cacheable prefix  ${String(prefix).padStart(6)} tokens   ${share.toFixed(1)}%`)
console.log(`  per question      ${String(perQuestion.input_tokens).padStart(6)} tokens   (1x1 crop + hint)`)
console.log(
  '\nA real crop adds roughly 1,200-1,600 tokens to the per-question line,\n' +
    'so expect the prefix share to land near 80% in production.',
)

// What a run cost, and what the money bought.
//
//   npm run ops:report                      (the last hour)
//   npm run ops:report -- --since 2026-09-09T14:00:00Z
//   npm run ops:report -- --hours 6
//   npm run ops:report -- --all
//
// Reads `ops_log` against the LIVE project and nothing else: it writes
// nothing, claims nothing and costs nothing. Operator-run, so it lives here
// rather than in the eval gate.
//
// It exists because "what did that run cost" was answerable only by writing a
// one-off query each time, and a one-off query is where the mistakes live: an
// earlier one selected two columns the table does not have, came back empty,
// and reported a paid run as a free one.
//
// The ledger has no question id — a batch is one call for many rows, and the
// figure lane is many calls for one — so the per-question figures are the
// window's spend over the questions STRUCTURED in that window, and are
// labelled as the averages they are rather than as a per-row price.
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../src/types/database.ts'
import { readEnvFile } from './env-file.ts'

const env = { ...readEnvFile('.env'), ...process.env }
const url = env.SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('SUPABASE_URL və SUPABASE_SERVICE_ROLE_KEY lazımdır: set -a; . ./.env; set +a')
  process.exit(1)
}
const db = createClient<Database>(url, key)

const args = process.argv.slice(2)
const flag = (name: string): string | null => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? (args[i + 1] ?? null) : null
}
const since = args.includes('--all')
  ? '1970-01-01T00:00:00Z'
  : (flag('since') ??
    new Date(Date.now() - Number(flag('hours') ?? 1) * 3600_000).toISOString())

// What each op is FOR, in the operator's terms. The ledger says
// `extract_anthropic`; what the operator is deciding about is the reading.
const WHAT: Record<string, string> = {
  extract_anthropic: 'sualin oxunmasi (metn + fiqur spesifikasiyasi)',
  verify_anthropic: 'orijinalla muqayise (yoxlama dalgasi)',
  figure_gen_gemini: 'fiqurun yeniden cekilmesi + variant sekilleri',
  figure_edit_gemini: 'cekilmis fiqura duzelis (Gemini)',
  figure_edit_openai: 'cekilmis fiqura duzelis (OpenAI)',
  // The two interactive ops, which run in the Edge Function at import time and
  // not in the worker. They are per BOOK, not per question, so they show up
  // once and then never again however many crops are sent.
  parse_answer_key: 'kitabin cavab acarinin oxunmasi (skan sehife, kitab basina)',
  detect_questions: 'skan sehifede suallarin yerinin tapilmasi (kitab basina)',
}

interface Bucket {
  calls: number
  cachedCalls: number
  batchCalls: number
  prompt: number
  cacheRead: number
  output: number
  cost: number
  ms: number
  timed: number
}

const empty = (): Bucket => ({
  calls: 0,
  cachedCalls: 0,
  batchCalls: 0,
  prompt: 0,
  cacheRead: 0,
  output: 0,
  cost: 0,
  ms: 0,
  timed: 0,
})

type LogRow = Database['public']['Tables']['ops_log']['Row']

function add(b: Bucket, r: LogRow): void {
  b.calls++
  if (r.cached) b.cachedCalls++
  if (r.via_batch) b.batchCalls++
  b.prompt += r.prompt_tokens ?? 0
  b.cacheRead += r.cached_tokens ?? 0
  b.output += r.output_tokens ?? 0
  b.cost += Number(r.est_cost_usd)
  if (r.ms != null) {
    b.ms += r.ms
    b.timed++
  }
}

// Paged, because a full-history report is thousands of rows and the client
// caps a select at a thousand without saying so.
const rows: LogRow[] = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await db
    .from('ops_log')
    .select('*')
    .gte('created_at', since)
    .order('id')
    .range(from, from + 999)
  if (error) throw error
  rows.push(...(data ?? []))
  if (!data || data.length < 1000) break
}

if (!rows.length) {
  console.log(`${since} tarixinden beri ops_log-da setir yoxdur.`)
  process.exit(0)
}

const { count: structured } = await db
  .from('questions')
  .select('id', { count: 'exact', head: true })
  .gte('structured_at', since)

const byOp = new Map<string, Bucket>()
const byModel = new Map<string, Bucket>()
const total = empty()
for (const r of rows) {
  const opKey = `${r.op}\t${r.model}\t${r.via_batch ? 'batch' : 'express'}`
  if (!byOp.has(opKey)) byOp.set(opKey, empty())
  add(byOp.get(opKey)!, r)
  if (!byModel.has(r.model)) byModel.set(r.model, empty())
  add(byModel.get(r.model)!, r)
  add(total, r)
}

const usd = (n: number): string => `$${n.toFixed(4)}`
const pct = (n: number, of: number): string => (of ? `${((n / of) * 100).toFixed(1)}%` : '-')
const int = (n: number): string => n.toLocaleString('en-US')

const first = rows[0]!.created_at
const last = rows[rows.length - 1]!.created_at
console.log(`\nPENCERE  ${first}  ->  ${last}`)
console.log(
  `SETIR    ${int(rows.length)} cagiris - ${int(structured ?? 0)} sual bu pencerede strukturlasdirilib`,
)
console.log(`CEMI     ${usd(total.cost)}\n`)

console.log('NEYE GEDIB')
for (const [key, b] of [...byOp.entries()].sort((a, b) => b[1].cost - a[1].cost)) {
  const [op, model, lane] = key.split('\t') as [string, string, string]
  const paid = b.calls - b.cachedCalls
  console.log(`\n  ${op}  -  ${model}  -  ${lane}`)
  console.log(`    ${WHAT[op] ?? 'teyinati senedlesdirilmeyib'}`)
  console.log(
    `    ${usd(b.cost)}  (cemin ${pct(b.cost, total.cost)})  -  ${int(b.calls)} cagiris` +
      (b.cachedCalls ? `  -  ${int(b.cachedCalls)} kesden (pulsuz)` : ''),
  )
  console.log(
    `    token: ${int(b.prompt)} giris (${int(b.cacheRead)} kes oxunusu) - ${int(b.output)} cixis` +
      (b.timed ? `  -  orta ${Math.round(b.ms / b.timed)} ms` : ''),
  )
  if (paid > 0) console.log(`    odenisli cagiris basina ${usd(b.cost / paid)}`)
}

console.log('\nMODEL UZRE')
for (const [model, b] of [...byModel.entries()].sort((a, b) => b[1].cost - a[1].cost)) {
  console.log(
    `  ${model.padEnd(26)} ${usd(b.cost).padStart(11)}  ${pct(b.cost, total.cost).padStart(6)}  ${int(b.calls)} cagiris`,
  )
}

if (structured) {
  console.log('\nSUAL BASINA (pencerenin cemi / pencerede strukturlasdirilan sual sayi)')
  console.log(`  hamisi birlikde        ${usd(total.cost / structured)}`)
  for (const [model, b] of [...byModel.entries()].sort((a, b) => b[1].cost - a[1].cost)) {
    console.log(`  ${model.padEnd(22)} ${usd(b.cost / structured)}`)
  }
  console.log(`\n  1000 sual bu qiymetle: ${usd((total.cost / structured) * 1000)}`)
}
console.log()

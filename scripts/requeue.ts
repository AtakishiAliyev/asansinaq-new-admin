// Re-queue rows by class, after a fix that changes how a class is handled.
//
//   npm run requeue -- --kind venn --pv-below 11          # what would move
//   npm run requeue -- --kind venn --pv-below 11 --apply  # move it
//   npm run requeue -- --flag kind_over_reach --apply
//   npm run requeue -- --book 22 --page 30 --apply
//
// It exists because of a gap a scale test found: a row that VERIFIED under an
// old prompt is never revisited. Verification only re-reads rows it rejected,
// so a routing fix reaches the rows that were already failing and silently
// leaves the ones that passed for the wrong reason. Two live rows sat wrong
// that way — one of them a graph built from eyeballed splines, marked verified.
//
// Dry by default. Re-queuing spends money on a re-read, so the destructive
// version has to be asked for, and the listing shows exactly which rows and
// why before anything is written.
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { readEnvFile } from './env-file.ts'

const env = { ...readEnvFile('.env'), ...process.env }
const url = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.')
  process.exit(2)
}
const db = createClient<Database>(url, key, { auth: { persistSession: false } })

const argv = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const has = (name: string) => argv.includes(`--${name}`)

const wantKind = flag('kind')
const wantFlag = flag('flag')
const pvBelow = flag('pv-below') ? Number(flag('pv-below')) : undefined
const wantBook = flag('book') ? Number(flag('book')) : undefined
const wantPage = flag('page') ? Number(flag('page')) : undefined
const onlyVerified = has('verified-only')
const apply = has('apply')

if (!wantKind && !wantFlag && pvBelow === undefined && !wantBook && !wantPage) {
  console.error(
    'Nothing selected. Use at least one of:\n' +
      '  --kind <figure kind>      rows whose figures include this kind\n' +
      '  --flag <code>             rows carrying this flag\n' +
      '  --pv-below <n>            rows read by a prompt older than n\n' +
      '  --book <id> --page <n>    rows from a book or page\n' +
      '  --verified-only           only rows that PASSED verification\n' +
      '  --apply                   actually re-queue (otherwise dry run)',
  )
  process.exit(2)
}

let query = db
  .from('questions')
  .select('id, book_id, page_number, q_no, status, verified, prompt_version, figures, flags')
  .eq('status', 'structured')
  .order('book_id')
  .order('page_number')
  .order('q_no')
if (wantBook !== undefined) query = query.eq('book_id', wantBook)
if (wantPage !== undefined) query = query.eq('page_number', wantPage)
if (pvBelow !== undefined) query = query.lt('prompt_version', pvBelow)
if (onlyVerified) query = query.eq('verified', true)

const { data, error } = await query
if (error) {
  console.error(error.message)
  process.exit(1)
}

// The jsonb filters are applied here rather than in the query: figures is a
// document and flags an array, and a wrong containment operator silently
// matches nothing, which in a re-queue tool reads as "the fix reached
// everything" — the exact false comfort this script exists to remove.
const rows = (data ?? []).filter((r) => {
  const kinds = ((r.figures as { items?: { kind: string }[] } | null)?.items ?? []).map((i) => i.kind)
  const codes = ((r.flags as { code: string }[] | null) ?? []).map((f) => f.code)
  if (wantKind && !kinds.includes(wantKind)) return false
  if (wantFlag && !codes.includes(wantFlag)) return false
  return true
})

if (!rows.length) {
  console.log('no rows match.')
  process.exit(0)
}

console.log(`${rows.length} row(s) match:\n`)
console.log('  id     book  page   q#   pv  verified  kinds')
for (const r of rows) {
  const kinds =
    ((r.figures as { items?: { kind: string }[] } | null)?.items ?? [])
      .map((i) => i.kind)
      .join('+') || '—'
  console.log(
    `  ${String(r.id).padEnd(6)} ${String(r.book_id).padEnd(5)} ${String(r.page_number).padEnd(6)} ` +
      `${String(r.q_no).padEnd(4)} ${String(r.prompt_version ?? '?').padEnd(3)} ` +
      `${String(r.verified).padEnd(9)} ${kinds}`,
  )
}

if (!apply) {
  console.log(
    `\nDRY RUN — nothing written. Re-run with --apply to queue these ${rows.length} row(s).\n` +
      'Each one costs a fresh extraction, and a verify wave after it.',
  )
  process.exit(0)
}

const ids = rows.map((r) => r.id)
const { error: writeError } = await db
  .from('questions')
  .update({
    queued_at: new Date().toISOString(),
    // Both budgets start over: this is deliberate new work, not a retry of
    // something that failed, and not a repair round.
    attempts: 0,
    repair_round: 0,
    verified: false,
    verified_at: null,
    verify_confidence: null,
    verify_diff: null,
    prev_version: null,
    claimed_at: null,
    claimed_by_worker: null,
    lease_until: null,
    batch_id: null,
    batch_custom_id: null,
    batch_stage: null,
  })
  .in('id', ids)
if (writeError) {
  console.error(writeError.message)
  process.exit(1)
}
console.log(
  `\nre-queued ${ids.length} row(s).\n` +
    'The worker picks them up on its next pass — watch the Suallar page, or\n' +
    '`npm run worker:status` if you want the log.',
)

// Which figure lane each book is on.
//
//   npm run figure-lane                        # what every book is on now
//   npm run figure-lane -- --all gen --apply   # switch every book over
//   npm run figure-lane -- --book 24 gen --apply
//   npm run figure-lane -- --all cut --apply   # the way back
//
// A script rather than a migration because this is a DECISION about a book, not
// a fact about the schema, and it has to be reversible in one command: the lane
// is an enhancement over a cut that already works, so the failure plan is
// "put it back on cut", and that plan is worthless if it needs a code change.
//
// Dry by default. Switching a book to `gen` means the next extraction spends
// real money on every figure it cuts, so the listing shows what would change
// before anything is written.
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
const apply = argv.includes('--apply')
const wantBook = flag('book') ? Number(flag('book')) : undefined
const target = flag('all') ?? flag('book-lane') ?? (wantBook ? argv[argv.indexOf('--book') + 2] : undefined)

if (target && target !== 'cut' && target !== 'gen') {
  console.error(`lane must be 'cut' or 'gen', got '${target}'`)
  process.exit(2)
}

const { data: books, error } = await db
  .from('books')
  .select('id, title, figure_render')
  .order('id')
if (error) {
  console.error(`could not read books: ${error.message}`)
  process.exit(1)
}

const affected = (books ?? []).filter((b) => (wantBook ? b.id === wantBook : true))
if (!affected.length) {
  console.log('no books matched.')
  process.exit(0)
}

for (const b of affected) {
  const change = target && target !== b.figure_render ? ` -> ${target}` : ''
  console.log(`  ${String(b.id).padStart(3)}  ${b.figure_render.padEnd(3)}${change}  ${b.title}`)
}

if (!target) {
  console.log('\nNothing to change — pass `--all gen` or `--book <id> gen` with `--apply`.')
  process.exit(0)
}

const moving = affected.filter((b) => b.figure_render !== target)
if (!moving.length) {
  console.log(`\nEvery matched book is already on '${target}'.`)
  process.exit(0)
}

if (!apply) {
  console.log(`\n${moving.length} book(s) would move to '${target}'. Re-run with --apply.`)
  process.exit(0)
}

const { error: writeError } = await db
  .from('books')
  .update({ figure_render: target })
  .in(
    'id',
    moving.map((b) => b.id),
  )
if (writeError) {
  console.error(`update failed: ${writeError.message}`)
  process.exit(1)
}
console.log(`\n${moving.length} book(s) now on '${target}'.`)

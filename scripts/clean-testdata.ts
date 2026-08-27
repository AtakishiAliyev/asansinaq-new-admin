// Wipes the imported material so a from-scratch import test starts from
// nothing.
//
//   npm run clean:testdata -- --project <ref> --yes
//
// It also refuses while any question still holds a submitted batch, because
// that work is already paid for and deleting the row is what makes the payment
// worthless. `--abandon-in-flight` says you mean it.
//
// DESTRUCTIVE AND IRREVERSIBLE. There is no soft delete here and no undo: the
// crops are the only copy of the cropping work, and the PDFs are the only copy
// of the upload. Run it when you mean to throw that away.
//
// It refuses unless BOTH flags are present, and the project ref must match the
// one in the configured URL. Two flags rather than one because the dangerous
// mistake is not mistyping a command — it is running the right command against
// the wrong project, and `--yes` alone cannot catch that.
//
// WHAT IT DELETES
//   questions          every row (nothing in the schema references them)
//   answer_keys        every row
//   books              every row  (must follow questions: the FK is RESTRICT)
//   ops_cache          every row  (its image_path rows point into cache/ below)
//   question-crops     every object, including the cache/ prefix
//   pdfs               every object
//
// WHAT IT LEAVES, deliberately
//   auth.users         accounts are not test data
//   admin_emails       the allowlist; wiping it locks everyone out and seeds
//                      do not run on `db push`
//   programs/subjects/categories   the taxonomy is configuration, and questions
//                      reference it rather than the other way round
//   ops_log            the spend ledger is an audit trail. It outlives the
//                      questions it describes, and a cleared ledger would let a
//                      day's budget be spent twice.
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../src/types/database.ts'

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
const url = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.')
  process.exit(2)
}

const actualRef = /https:\/\/([a-z0-9]+)\.supabase\./i.exec(url)?.[1] ?? url
const argv = process.argv.slice(2)
const confirmed = argv.includes('--yes')
const claimedRef = argv[argv.indexOf('--project') + 1]
const abandonInFlight = argv.includes('--abandon-in-flight')

if (!confirmed || !argv.includes('--project') || claimedRef !== actualRef) {
  console.error('This deletes every question, answer key, book, cached op and')
  console.error('stored file in the target project. It cannot be undone.\n')
  console.error(`  target project ref : ${actualRef}`)
  console.error(`  confirmed ref      : ${claimedRef ?? '(none given)'}`)
  console.error(`  --yes              : ${confirmed ? 'yes' : 'no'}\n`)
  console.error('To proceed, name the project explicitly:')
  console.error(`  npm run clean:testdata -- --project ${actualRef} --yes`)
  process.exit(1)
}

const db = createClient<Database>(url, key, { auth: { persistSession: false } })

/**
 * Refuse to delete rows that are still holding a submitted batch.
 *
 * A batch is paid for the moment it is submitted, and its results are the only
 * thing that payment buys. Deleting the rows that hold its handle does not
 * cancel it — it just removes the only place the answers could ever land, so
 * the provider finishes the work, bills for it, and the worker finds nothing to
 * write it to. That has already happened once here: eight questions were
 * submitted, the bank was cleared while they were in flight, and the run came
 * back to an empty table.
 *
 * A separate flag from `--yes` on purpose. `--yes` means "I meant to delete
 * this"; this one means "I know I am throwing away work that has been paid
 * for", which is a different thing to be sure about.
 */
async function refuseIfInFlight(): Promise<void> {
  const { data, error } = await db
    .from('questions')
    .select('id, batch_id, batch_stage')
    .not('batch_id', 'is', null)
  if (error) {
    // Not fatal, but not silent either: a check that could not run must not
    // read as a check that passed.
    console.error(`WARNING: could not check for in-flight batches — ${error.message}`)
    console.error('Proceeding anyway; if a run is in flight its results are lost.\n')
    return
  }
  const rows = data ?? []
  if (!rows.length) return

  const byBatch = new Map<string, number>()
  for (const row of rows) {
    const id = String(row.batch_id)
    byBatch.set(id, (byBatch.get(id) ?? 0) + 1)
  }
  console.error(`${rows.length} question(s) are still holding a submitted batch:\n`)
  for (const [batchId, count] of byBatch) {
    const stage = rows.find((r) => r.batch_id === batchId)?.batch_stage ?? '?'
    console.error(`  ${batchId}  ${stage.padEnd(7)} ${count} question(s)`)
  }
  console.error(
    '\nThat work is already paid for. Deleting these rows does not cancel the\n' +
      'batch — it removes the only place its results could land, so the money is\n' +
      'spent and nothing is kept.\n\n' +
      'Let the worker collect them first (it resumes polling on its own), or if\n' +
      'you genuinely mean to throw the results away:\n' +
      `  npm run clean:testdata -- --project ${actualRef} --yes --abandon-in-flight`,
  )
  process.exit(1)
}

if (!abandonInFlight) await refuseIfInFlight()

async function tableCount(table: 'questions' | 'answer_keys' | 'books' | 'ops_cache' | 'ops_log') {
  const { count, error } = await db.from(table).select('*', { count: 'exact', head: true })
  if (error) throw new Error(`${table}: ${error.message}`)
  return count ?? 0
}

/** Storage listing is one page of one prefix at a time; folders come back with
 *  a null id and have to be walked. Nothing is deleted that was not listed. */
async function listAll(bucket: string, prefix = ''): Promise<string[]> {
  const found: string[] = []
  const PAGE = 100
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db.storage
      .from(bucket)
      .list(prefix, { limit: PAGE, offset })
    if (error) throw new Error(`${bucket}/${prefix}: ${error.message}`)
    const entries = data ?? []
    for (const entry of entries) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.id === null) found.push(...(await listAll(bucket, path)))
      else found.push(path)
    }
    if (entries.length < PAGE) break
  }
  return found
}

async function emptyBucket(bucket: string): Promise<number> {
  const paths = await listAll(bucket)
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100)
    const { error } = await db.storage.from(bucket).remove(chunk)
    if (error) throw new Error(`${bucket}: ${error.message}`)
  }
  return paths.length
}

console.log(`target project : ${actualRef}`)
console.log('counting before…\n')

const before = {
  questions: await tableCount('questions'),
  answer_keys: await tableCount('answer_keys'),
  books: await tableCount('books'),
  ops_cache: await tableCount('ops_cache'),
  ops_log: await tableCount('ops_log'),
}

const crops = await listAll('question-crops')
const pdfs = await listAll('pdfs')
const cropCacheObjects = crops.filter((p) => p.startsWith('cache/')).length

console.table({
  questions: before.questions,
  answer_keys: before.answer_keys,
  books: before.books,
  ops_cache: before.ops_cache,
  'question-crops (objects)': crops.length,
  '  of which cache/': cropCacheObjects,
  'pdfs (objects)': pdfs.length,
  'ops_log (PRESERVED)': before.ops_log,
})

console.log('\ndeleting…')

// Order follows the FKs, not preference: questions.book_id is ON DELETE
// RESTRICT, so books cannot go first. answer_keys would cascade with the book,
// but is cleared explicitly so the count is reported rather than inferred.
const { error: qError } = await db.from('questions').delete().gt('id', 0)
if (qError) throw new Error(`questions: ${qError.message}`)

const { error: kError } = await db.from('answer_keys').delete().gt('book_id', 0)
if (kError) throw new Error(`answer_keys: ${kError.message}`)

const { error: bError } = await db.from('books').delete().gt('id', 0)
if (bError) throw new Error(`books: ${bError.message}`)

// Emptied because its rows name objects under cache/ that are about to stop
// existing. A cache entry pointing at a deleted image is worse than a miss:
// the pipeline reads it as a hit and finds nothing behind it.
const { error: cError } = await db.from('ops_cache').delete().neq('key', '')
if (cError) throw new Error(`ops_cache: ${cError.message}`)

const cropsRemoved = await emptyBucket('question-crops')
const pdfsRemoved = await emptyBucket('pdfs')

const after = {
  questions: await tableCount('questions'),
  answer_keys: await tableCount('answer_keys'),
  books: await tableCount('books'),
  ops_cache: await tableCount('ops_cache'),
  ops_log: await tableCount('ops_log'),
}

console.log('\ndeleted:')
console.table({
  questions: before.questions - after.questions,
  answer_keys: before.answer_keys - after.answer_keys,
  books: before.books - after.books,
  ops_cache: before.ops_cache - after.ops_cache,
  'question-crops (objects)': cropsRemoved,
  'pdfs (objects)': pdfsRemoved,
})

const leftovers = [
  after.questions && `questions=${after.questions}`,
  after.answer_keys && `answer_keys=${after.answer_keys}`,
  after.books && `books=${after.books}`,
  after.ops_cache && `ops_cache=${after.ops_cache}`,
  (await listAll('question-crops')).length && 'question-crops not empty',
  (await listAll('pdfs')).length && 'pdfs not empty',
].filter(Boolean)

if (leftovers.length) {
  console.error(`\nINCOMPLETE — still present: ${leftovers.join(', ')}`)
  process.exit(1)
}

console.log(`\nclean. ops_log preserved: ${after.ops_log} row(s).`)
console.log('Taxonomy, admin allowlist and auth users were not touched.')

// Removes storage objects no row refers to any more.
//
//   npm run prune:storage              (report only — deletes nothing)
//   npm run prune:storage -- --apply   (delete what the report listed)
//
// Every question owns pictures in `question-crops`: its crop, its figure cuts,
// its option images, and on a `gen` book one reproduction per figure plus one
// more per corrective edit. A row deleted from the dashboard, or a drawing
// superseded by an edit before the worker learned to remove the old one, left
// its objects behind — and on the first measured run those were 529 of 588
// objects and 90% of the bucket.
//
// An object is kept if ANY of these names it:
//   questions.crop_path, its option images, its figures' cut and reproduction,
//   and the same fields of the version parked in prev_version — a rejected
//   repair rolls BACK to that, so its pictures are live while it is parked;
//   ops_cache.image_path — cached answers point into the cache/ prefix;
//   books.storage_path — the archived PDFs, in their own bucket.
//
// Nothing is deleted that was not first listed, and nothing is deleted without
// `--apply`. Referenced objects are never candidates, whatever the flags.
import { createClient } from '@supabase/supabase-js'
import { storedPathsOf } from '../src/core/questions/image-paths.ts'
import type { Database } from '../src/types/database.ts'
import { readEnvFile } from './env-file.ts'

const env = { ...readEnvFile('.env'), ...process.env }
const url = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.')
  process.exit(2)
}
const apply = process.argv.includes('--apply')
const db = createClient<Database>(url, key, { auth: { persistSession: false } })

/** Storage listing is one page of one prefix at a time; folders come back with
 *  a null id and have to be walked. */
async function listAll(bucket: string, prefix = ''): Promise<{ path: string; size: number }[]> {
  const found: { path: string; size: number }[] = []
  const PAGE = 1000
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db.storage.from(bucket).list(prefix, { limit: PAGE, offset })
    if (error) throw new Error(`${bucket}/${prefix}: ${error.message}`)
    const entries = data ?? []
    for (const entry of entries) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.id === null) found.push(...(await listAll(bucket, path)))
      else found.push({ path, size: (entry.metadata as { size?: number } | null)?.size ?? 0 })
    }
    if (entries.length < PAGE) break
  }
  return found
}

/** Everything a row can name, paged: a truncated read here would turn live
 *  pictures into candidates. */
async function referencedCrops(): Promise<Set<string>> {
  const referenced = new Set<string>()
  const PAGE = 1000
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db
      .from('questions')
      .select('crop_path, options, figures, prev_version')
      .order('id')
      .range(offset, offset + PAGE - 1)
    if (error) throw new Error(`questions: ${error.message}`)
    const rows = data ?? []
    for (const row of rows) for (const p of storedPathsOf(row)) referenced.add(p)
    if (rows.length < PAGE) break
  }
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db
      .from('ops_cache')
      .select('image_path')
      .not('image_path', 'is', null)
      .range(offset, offset + PAGE - 1)
    if (error) throw new Error(`ops_cache: ${error.message}`)
    const rows = data ?? []
    for (const row of rows) if (row.image_path) referenced.add(row.image_path)
    if (rows.length < PAGE) break
  }
  return referenced
}

async function referencedPdfs(): Promise<Set<string>> {
  const { data, error } = await db.from('books').select('storage_path')
  if (error) throw new Error(`books: ${error.message}`)
  return new Set((data ?? []).map((b) => b.storage_path).filter((p): p is string => Boolean(p)))
}

/** What kind of object this is, so the report says WHY things leaked. */
function kindOf(path: string): string {
  if (/\.gen\d+\./.test(path)) return 'düzəliş versiyası (.genN)'
  if (/\.gen\./.test(path)) return 'ilk çəkiliş (.gen)'
  if (/_fig\d+/.test(path)) return 'fiqur kəsimi'
  if (/_opt[A-E]/.test(path)) return 'variant şəkli'
  if (path.startsWith('cache/')) return 'keş obyekti'
  return 'kəsim (crop)'
}

const mb = (bytes: number) => (bytes / 1048576).toFixed(1)

let total = 0
for (const [bucket, referenced] of [
  ['question-crops', await referencedCrops()],
  ['pdfs', await referencedPdfs()],
] as const) {
  const objects = await listAll(bucket)
  const orphans = objects.filter((o) => !referenced.has(o.path))
  const bytes = orphans.reduce((a, o) => a + o.size, 0)
  console.log(
    `\n${bucket}: ${objects.length} obyekt, ${referenced.size} istinad, ` +
      `${orphans.length} yetim (${mb(bytes)} MB)`,
  )
  const byKind = new Map<string, { n: number; bytes: number }>()
  for (const o of orphans) {
    const k = kindOf(o.path)
    const e = byKind.get(k) ?? { n: 0, bytes: 0 }
    e.n++
    e.bytes += o.size
    byKind.set(k, e)
  }
  for (const [k, e] of [...byKind].sort((a, b) => b[1].bytes - a[1].bytes)) {
    console.log(`  ${k.padEnd(28)} ${String(e.n).padStart(4)}  ${mb(e.bytes).padStart(7)} MB`)
  }
  total += orphans.length
  if (!apply || !orphans.length) continue
  for (let i = 0; i < orphans.length; i += 100) {
    const chunk = orphans.slice(i, i + 100).map((o) => o.path)
    const { error } = await db.storage.from(bucket).remove(chunk)
    if (error) throw new Error(`${bucket}: ${error.message}`)
  }
  console.log(`  silindi: ${orphans.length}`)
}

if (!apply && total) console.log(`\n${total} yetim. Silmək üçün: npm run prune:storage -- --apply`)
if (!total) console.log('\nYetim yoxdur.')

// Seeds the YÖS category trees for Geometri and Mantık.
//
//   npm run seed:categories
//
// Idempotent: a name that already exists under the subject is skipped, so a
// re-run adds only what is missing and can never duplicate. Safe to run against
// a project that is partly seeded.
//
// FLAT. Every row is top level, `parent_id` null, mirroring the twelve
// Matematik rows that were already there. The source material groups these
// under section headers ("Bölüm 1", "Şekil ve Görsel Mantık"); those are
// labels for reading, not categories a question is filed under, and inserting
// them would put a level of nesting between every question and its real
// category for no gain.
//
// `sort_order` ascends in the order written below, because the order IS the
// content: these are curriculum sequences, and the taxonomy page orders by
// sort_order then name, so leaving them at 0 would file "Uzay Geometri" between
// "Terazi" and "Yamuk" and lose the sequence entirely. Subjects already carry
// explicit sort_order in seed.sql for the same reason.
//
// Existing rows are repaired, not just skipped — the first run of this script
// inserted them all at 0.
//
// Data, not schema, so this is not a migration. CLAUDE.md puts data in
// seed.sql; seeds do not run on `db push`, which is why it is also a script
// that can be pointed at the live project.
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../src/types/database.ts'

/** Subject id → the name it must actually have, so a drifted id cannot file
 *  twenty geometry categories under logic without anyone noticing. */
const PLAN: { subjectId: number; expectName: string; categories: string[] }[] = [
  {
    subjectId: 9,
    expectName: 'Geometri',
    categories: [
      'Doğruda Açılar',
      'Üçgende Açılar',
      'Özel Üçgenler',
      'Üçgende Alan',
      'Üçgende Açıortay',
      'Üçgende Kenarortay',
      'Üçgende Benzerlik',
      'Üçgende Açı-Kenar Bağıntıları',
      'Çokgenler',
      'Genel Dörtgenler',
      'Paralelkenar',
      'Eşkenar Dörtgen',
      'Dikdörtgen',
      'Kare',
      'Yamuk',
      'Çemberde Açı',
      'Çemberde Uzunluk',
      'Dairede Alan',
      'Nokta ve Doğrunun Analitik İncelenmesi',
      'Uzay Geometri ve Katı Cisimler',
    ],
  },
  {
    subjectId: 10,
    expectName: 'Mantık',
    categories: [
      'Şekil tamamlama ve ilişki kurma',
      'Matrisler (3x3 şekil ilişkileri)',
      'Şekil döndürme ve simetri',
      'Küplerin sayılması ve küp açılımları',
      'Çizgi, alan ve nokta grafikleri yorumlama',
      'İşlem (operatör sembolleriyle tanımlanan kurallar)',
      'Sayı dizileri ve örüntüler',
      'Tablo ve çizelge yorumlama',
      'Sütun ve daire grafikleri',
      'Şifreleme ve harf-sayı dönüşüm bulmacaları',
      'Terazi denge problemleri',
      'Blok/sıralama ve yön bulma bulmacaları',
      'Mantıksal çıkarım ve kümeler mantığı',
    ],
  },
]

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

const db = createClient<Database>(url, key, { auth: { persistSession: false } })

for (const { subjectId, expectName, categories } of PLAN) {
  const { data: subject, error: subjectError } = await db
    .from('subjects')
    .select('id, name')
    .eq('id', subjectId)
    .maybeSingle()
  if (subjectError) throw new Error(`subject ${subjectId}: ${subjectError.message}`)
  if (!subject) throw new Error(`subject ${subjectId} does not exist`)
  if (subject.name !== expectName) {
    throw new Error(
      `subject ${subjectId} is "${subject.name}", expected "${expectName}" — ` +
        'ids have drifted, refusing to file categories under the wrong subject',
    )
  }

  const { data: existing, error: existingError } = await db
    .from('categories')
    .select('id, name, sort_order')
    .eq('subject_id', subjectId)
  if (existingError) throw new Error(`categories ${subjectId}: ${existingError.message}`)

  // The unique index is on lower(name), so the match has to be case-insensitive
  // or a re-run would fail on a case difference rather than recognising the row.
  const key = (name: string) => name.toLocaleLowerCase('tr')
  const byName = new Map((existing ?? []).map((c) => [key(c.name), c]))

  const missing = categories.filter((name) => !byName.has(key(name)))
  if (missing.length) {
    // id is GENERATED ALWAYS — supplying one is an error, not an override.
    const { error } = await db.from('categories').insert(
      missing.map((name) => ({
        subject_id: subjectId,
        name,
        parent_id: null,
        sort_order: categories.indexOf(name) + 1,
      })),
    )
    if (error) throw new Error(`insert into ${expectName}: ${error.message}`)
  }

  // Rows that already exist may carry the wrong position — every row the first
  // run of this script created is sitting at 0.
  let reordered = 0
  for (const [index, name] of categories.entries()) {
    const row = byName.get(key(name))
    if (!row || row.sort_order === index + 1) continue
    const { error } = await db
      .from('categories')
      .update({ sort_order: index + 1 })
      .eq('id', row.id)
    if (error) throw new Error(`reorder ${name}: ${error.message}`)
    reordered++
  }

  console.log(
    `${expectName} (subject ${subjectId}): ${missing.length} inserted, ` +
      `${categories.length - missing.length} already present, ${reordered} reordered`,
  )
}

console.log('\nfinal count per subject:')
const { data: subjects } = await db.from('subjects').select('id, name').order('id')
for (const subject of subjects ?? []) {
  const { count } = await db
    .from('categories')
    .select('*', { count: 'exact', head: true })
    .eq('subject_id', subject.id)
  const { count: nested } = await db
    .from('categories')
    .select('*', { count: 'exact', head: true })
    .eq('subject_id', subject.id)
    .not('parent_id', 'is', null)
  const { count: unordered } = await db
    .from('categories')
    .select('*', { count: 'exact', head: true })
    .eq('subject_id', subject.id)
    .eq('sort_order', 0)
  console.log(
    `  ${subject.id}  ${subject.name.padEnd(12)} ${String(count ?? 0).padStart(3)} categories` +
      (nested ? `  (${nested} NESTED — expected all flat)` : '') +
      // Not an error: Matematik predates this script and has no stated order,
      // so it sorts by name. Worth showing rather than leaving to be discovered.
      (unordered ? `  (${unordered} at sort_order 0 — listed alphabetically)` : ''),
  )
}

// Put a student account back to an earlier point in the flow, so the
// screens after it can be walked again.
//
//   npm run dev:reset -- ada@example.com                 (the level test)
//   npm run dev:reset -- ada@example.com --onboarding    (and the three questions)
//
// A placement is deliberately a one-shot thing — the server refuses a second
// draw, which is the whole point of it living there — so there is no way to
// replay the test from inside the app, and testing its UI on one real
// account means reaching past it. That is what this is for: an OPERATOR
// tool, run against the live project with the service key, never reachable
// from either app.
//
// It touches one account, named in full, and prints what it changed. It does
// not delete the account, the answers it gave, or anything else.
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../src/types/database.ts'
import { readEnvFile } from './env-file.ts'

const env = { ...readEnvFile('.env'), ...process.env }

const args = process.argv.slice(2)
const email = args.find((a) => !a.startsWith('--'))?.trim().toLowerCase()
const alsoOnboarding = args.includes('--onboarding')

if (!email) {
  console.error(
    'İstifadə: npm run dev:reset -- <e-poçt> [--onboarding]\n\n' +
      '  (arqumentsiz)   səviyyə testini sıfırlayır\n' +
      '  --onboarding    hədəf, sinif və adı da sıfırlayır (bütün axın)',
  )
  process.exit(1)
}

const url = env.VITE_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('VITE_SUPABASE_URL və SUPABASE_SERVICE_ROLE_KEY lazımdır. Əvvəlcə: set -a; . ./.env; set +a')
  process.exit(1)
}

const supabase = createClient<Database>(url, key, { auth: { persistSession: false } })

// The admin API has no "find by email", so the page is walked. A project
// with more students than this will need the filter the API gained later;
// until then, one page is every account there is.
const { data: users, error: listError } = await supabase.auth.admin.listUsers({ perPage: 1000 })
if (listError) {
  console.error(`İstifadəçilər oxunmadı: ${listError.message}`)
  process.exit(1)
}

const user = users.users.find((u) => (u.email ?? '').toLowerCase() === email)
if (!user) {
  console.error(`Belə hesab yoxdur: ${email}`)
  process.exit(1)
}

const patch: Database['public']['Tables']['profiles']['Update'] = {
  level: null,
  placement_score: null,
  placement_at: null,
}
if (alsoOnboarding) {
  patch.onboarded_at = null
  patch.goal_score = null
  patch.grade = null
}

const { error: updateError } = await supabase.from('profiles').update(patch).eq('id', user.id)
if (updateError) {
  console.error(`Profil yazılmadı: ${updateError.message}`)
  process.exit(1)
}

// An attempt row would otherwise be resumed — same twelve, same expired
// clock — and the reset would look like it had done nothing.
const { error: attemptError } = await supabase
  .from('placement_attempts')
  .delete()
  .eq('user_id', user.id)
if (attemptError) {
  console.error(`Cəhd silinmədi: ${attemptError.message}`)
  process.exit(1)
}

console.log(`${email} sıfırlandı:`)
console.log('  • səviyyə, bal və placement_at → boş')
console.log('  • yarımçıq cəhd (varsa) → silindi')
if (alsoOnboarding) console.log('  • hədəf, sinif və onboarded_at → boş')
console.log(
  `\nİndi tətbiqi aç: ${alsoOnboarding ? '/start — üç sualdan başlayır' : '/placement — səviyyə testi yenidən çıxır'}`,
)

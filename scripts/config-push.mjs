// `supabase config push` writes this repo's config.toml over the HOSTED
// project's settings, auth included.
//
// Moving site_url out of config.toml and into `env()` was meant to stop a dev
// machine from repointing production's auth at localhost. It does not: .env
// holds the local values by design, so the push still ships whatever is in the
// shell — the hazard moved, it did not go away. This wrapper is where it
// actually stops: a push carrying a loopback URL is refused, because there is
// no situation in which the hosted project should redirect sign-ins to a
// laptop.
//
// Usage: npm run config:push   (set -a; . ./.env; set +a  first)

import { spawnSync } from 'node:child_process'

const REQUIRED = ['SUPABASE_AUTH_SITE_URL', 'SUPABASE_AUTH_REDIRECT_WILDCARD']
const LOOPBACK = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)/i

const missing = REQUIRED.filter((k) => !process.env[k])
if (missing.length) {
  console.error(
    `config push dayandırıldı — bu dəyişənlər boşdur: ${missing.join(', ')}\n` +
      'Əvvəlcə: set -a; . ./.env; set +a',
  )
  process.exit(1)
}

const local = REQUIRED.filter((k) => LOOPBACK.test(process.env[k]))
if (local.length) {
  console.error(
    'config push dayandırıldı — prodakşna localhost göndərilirdi:\n' +
      local.map((k) => `  ${k}=${process.env[k]}`).join('\n') +
      '\n\nHosted layihənin auth e-poçtları və redirect siyahısı bu ünvanlara\n' +
      'yönələcəkdi, yəni heç kim daxil ola bilməyəcəkdi. Deploy olunmuş\n' +
      'domeni yazın, sonra təkrar cəhd edin.',
  )
  process.exit(1)
}

console.log('Auth URL-ləri:')
for (const k of REQUIRED) console.log(`  ${k}=${process.env[k]}`)
console.log('\nconfig push işə salınır…\n')

const result = spawnSync('npx', ['supabase', 'config', 'push'], {
  stdio: 'inherit',
  env: process.env,
})
process.exit(result.status ?? 1)

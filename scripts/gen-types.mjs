// Regenerates src/types/database.ts from the linked Supabase project.
//
// Not a plain `supabase gen types … > src/types/database.ts`: the shell
// truncates the target BEFORE the command runs, and the CLI prints its errors
// to stdout, so running it unauthenticated replaced 700 lines of generated
// types with a one-line error object — and every import in the app failed at
// once, for a reason that looked nothing like "you are logged out".
//
// Generate into memory, check it actually looks like the schema, then write.
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const PROJECT_ID = 'bzcausrjnxdkwyewjfar'
const OUT = 'src/types/database.ts'

let generated = ''
try {
  generated = execFileSync(
    'npx',
    [
      'supabase',
      'gen',
      'types',
      'typescript',
      '--project-id',
      PROJECT_ID,
      '--schema',
      'public',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  )
} catch (error) {
  generated = typeof error.stdout === 'string' ? error.stdout : ''
}

if (!generated.includes('export type Database')) {
  console.error(
    `${OUT} SAXLANILDI — supabase sxem qaytarmadı:\n${generated.trim().slice(0, 300) || '(boş cavab)'}\n\n` +
      'Çox güman `npx supabase login` lazımdır.',
  )
  process.exit(1)
}

writeFileSync(OUT, generated)
console.log(`${OUT} yeniləndi (${generated.split('\n').length} sətir)`)

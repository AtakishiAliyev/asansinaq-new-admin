// Does the verification wave actually catch anything?
//
//   npm run smoke:verify            (a few rows)
//   npm run smoke:verify -- --rows 6
//
// MANUAL AND OPERATOR-RUN, and unlike the other smokes this one COSTS MONEY:
// roughly one Sonnet call per row per corruption, each carrying two images.
// Budget a few tens of cents for a default run.
//
// It exists because "verified" is the strongest claim this pipeline makes and
// the easiest to fake. A wave that answers "matches: true" to everything
// produces a green tick on every row, an empty review queue, and an
// auto-approve lane that passes unread work — and it is indistinguishable from
// a wave that works, unless something deliberately hands it questions that are
// WRONG and checks that it says so.
//
// So real rows are damaged in specific, known ways and fed through the same
// render-and-compare path the worker uses. The control variant is not optional
// decoration: a "verifier" that flags everything would catch every corruption
// and be equally useless, so passing the untouched row is half the test.
//
// Nothing is written to the database. The corruptions live in memory.
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import {
  buildVerifyRequest,
  describeFigure,
  EMIT_VERDICT_TOOL_NAME,
  parseVerdict,
  type Verdict,
} from '../src/core/extract/verify-request.ts'
import { samplingFor } from '../src/core/models.ts'
import type { ExtractedQuestion } from '../src/core/questions/extraction.ts'
import type { GeometryFig } from '../src/core/figures/figspec.ts'
import type { Database } from '../src/types/database.ts'
import { renderQuestion, fetchOptionImages } from '../worker/render-question.ts'
import { readEnvFile } from './env-file.ts'

const env = { ...readEnvFile('.env'), ...process.env }
const url = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
const apiKey = env.ANTHROPIC_API_KEY
if (!url || !key || !apiKey) {
  console.error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and ANTHROPIC_API_KEY are required.')
  process.exit(2)
}
const MODEL = env.MODEL_VERIFY ?? 'claude-sonnet-5'

const db = createClient<Database>(url, key, { auth: { persistSession: false } })
const anthropic = new Anthropic({ apiKey })

const argv = process.argv.slice(2)
const rowLimit = Number(argv[argv.indexOf('--rows') + 1]) || 4
/** `--ids 458,459` to aim at specific rows — the figure corruptions only apply
 *  to questions that HAVE a figure, and a text-only sample skips half the test. */
const onlyIds = argv.includes('--ids')
  ? (argv[argv.indexOf('--ids') + 1] ?? '').split(',').map(Number).filter(Boolean)
  : null

/**
 * Rows that are ALREADY unfaithful, and why.
 *
 * The control variant asserts that an untouched row reads as clean, which
 * assumes the bank is correct. #461 is deliberately not correct: it is the
 * kept-unfixed regression case whose asked angle is never declared in the
 * figure, so the wave flagging it is the behaviour we want, not a false alarm.
 * Listing it here keeps the harness honest in both directions — if the wave
 * ever stops flagging #461, this line turns it into a failure instead of
 * quietly congratulating it for agreeing.
 */
const KNOWN_UNFAITHFUL = new Map<number, string>([
  [461, 'asked angle m(CDE) is never declared in the figure spec'],
])

type Corruption = {
  name: string
  /** What the verifier ought to say. */
  expect: 'caught' | 'clean'
  apply: (q: ExtractedQuestion) => ExtractedQuestion | null
}

const clone = (q: ExtractedQuestion): ExtractedQuestion =>
  JSON.parse(JSON.stringify(q)) as ExtractedQuestion

const CORRUPTIONS: Corruption[] = [
  {
    name: 'control (untouched)',
    expect: 'clean',
    apply: (q) => q,
  },
  {
    name: 'changed digit in stem',
    expect: 'caught',
    apply: (q) => {
      const next = clone(q)
      let done = false
      next.stem = next.stem.replace(/\d/g, (d) => {
        if (done) return d
        done = true
        return String((Number(d) + 1) % 10)
      })
      return done ? next : null
    },
  },
  {
    name: 'one option removed',
    expect: 'caught',
    apply: (q) => {
      if (q.options.length < 3) return null
      const next = clone(q)
      next.options.splice(2, 1)
      return next
    },
  },
  {
    name: 'option content replaced',
    expect: 'caught',
    apply: (q) => {
      const next = clone(q)
      const target = next.options.find((o) => o.tex)
      if (!target) return null
      target.tex = '999'
      return next
    },
  },
  {
    name: 'figure mark removed',
    expect: 'caught',
    apply: (q) => {
      const next = clone(q)
      const geo = next.figures?.items.find((i) => i.kind === 'geometry') as
        | GeometryFig
        | undefined
      if (!geo) return null
      let removed = false
      for (const line of geo.lines) {
        if (line.ticks) {
          delete line.ticks
          removed = true
        }
        if (line.parallel) {
          delete line.parallel
          removed = true
        }
      }
      for (const angle of geo.angles ?? []) {
        if (angle.arcs) {
          delete angle.arcs
          removed = true
        }
        if (angle.right) {
          delete angle.right
          removed = true
        }
      }
      return removed ? next : null
    },
  },
  {
    name: 'figure edge removed',
    expect: 'caught',
    apply: (q) => {
      const next = clone(q)
      const geo = next.figures?.items.find((i) => i.kind === 'geometry') as
        | GeometryFig
        | undefined
      if (!geo || geo.lines.length < 3) return null
      geo.lines.splice(1, 1)
      return next
    },
  },
]

/**
 * A verdict, plus whether it was actually READ.
 *
 * `parseVerdict` deliberately turns anything unreadable into a non-match, which
 * is right in production — an unparsed verdict must never grant `verified`. But
 * in this harness that same default silently converts a broken call into a
 * "caught", and a test that scores its own failures as passes is worse than no
 * test. So the call reports the parse separately from the verdict.
 */
async function verdictFor(
  crop: { image: string; mime: 'image/png' | 'image/jpeg' },
  question: ExtractedQuestion,
  images: Map<string, string>,
): Promise<{ verdict: Verdict; parsed: boolean; stopReason: string; raw: string }> {
  const rendered = renderQuestion(question, images)
  const request = buildVerifyRequest({
    original: crop,
    recreation: { image: rendered.png.toString('base64') },
    figureClaims: describeFigure(question.figures),
  })
  const message = await anthropic.messages.create({
    model: MODEL,
    ...samplingFor(MODEL),
    ...request.params,
  })
  const block = message.content.find(
    (b) => b.type === 'tool_use' && b.name === EMIT_VERDICT_TOOL_NAME,
  )
  const input =
    block && block.type === 'tool_use' ? (block.input as Record<string, unknown>) : null
  return {
    verdict: parseVerdict(input),
    parsed: typeof input?.matches === 'boolean' && Array.isArray(input?.difference_fields),
    stopReason: message.stop_reason ?? '?',
    raw: JSON.stringify(input),
  }
}

/** The control on a known-bad row expects a catch, not a clean pass. */
function expectedFor(rowId: number, corruption: Corruption): 'caught' | 'clean' {
  if (corruption.expect === 'clean' && KNOWN_UNFAITHFUL.has(rowId)) return 'caught'
  return corruption.expect
}

const query = db
  .from('questions')
  .select('id, q_no, stem, options, figures, crop_path, crop_mime')
  .eq('status', 'structured')
  .order('id')
const { data: rows } = onlyIds
  ? await query.in('id', onlyIds)
  : await query.not('stem', 'is', null).limit(rowLimit)

if (!rows?.length) {
  console.error('no structured rows to exercise.')
  process.exit(2)
}

console.log(`model=${MODEL}  rows=${rows.length}\n`)

interface Result {
  row: number
  corruption: string
  expect: 'caught' | 'clean'
  got: 'caught' | 'clean'
  confidence: number
  detail: string
  parsed: boolean
  stopReason: string
  raw: string
}
const results: Result[] = []

for (const row of rows) {
  const { data: blob } = await db.storage.from('question-crops').download(row.crop_path)
  if (!blob) continue
  const crop = {
    image: Buffer.from(await blob.arrayBuffer()).toString('base64'),
    mime: (row.crop_mime === 'image/jpeg' ? 'image/jpeg' : 'image/png') as
      | 'image/png'
      | 'image/jpeg',
  }
  const base: ExtractedQuestion = {
    numberSeen: row.q_no,
    stem: row.stem ?? '',
    options: (row.options ?? []) as unknown as ExtractedQuestion['options'],
    figures: (row.figures ?? null) as unknown as ExtractedQuestion['figures'],
    illegible: false,
    clipped: false,
    foreign: false,
    confidence: 1,
    warnings: [],
  }
  const images = await fetchOptionImages(db, base)

  for (const corruption of CORRUPTIONS) {
    const damaged = corruption.apply(base)
    if (!damaged) {
      console.log(`  q${row.id} ${corruption.name.padEnd(24)} n/a (not applicable)`)
      continue
    }
    const { verdict, parsed, stopReason, raw } = await verdictFor(crop, damaged, images)
    const got = verdict.matches ? 'clean' : 'caught'
    const expect = expectedFor(row.id, corruption)
    // An unread verdict is never a pass, whichever way it happened to fall.
    const ok = parsed && got === expect
    results.push({
      row: row.id,
      corruption: corruption.name,
      expect,
      got,
      confidence: verdict.confidence,
      detail: verdict.differences.map((d) => `${d.field}:${d.severity}`).join(' ') || '—',
      parsed,
      stopReason,
      raw,
    })
    console.log(
      `  ${ok ? 'PASS' : 'FAIL'} q${row.id} ${corruption.name.padEnd(24)} ` +
        `expected=${expect} got=${parsed ? got : `UNREAD(${stopReason})`} ` +
        `conf=${verdict.confidence.toFixed(2)} ${
          verdict.differences[0]?.note.slice(0, 70) ?? ''
        }`,
    )
  }
}

const byKind = new Map<string, { pass: number; total: number }>()
for (const r of results) {
  const entry = byKind.get(r.corruption) ?? { pass: 0, total: 0 }
  entry.total++
  if (r.parsed && r.got === r.expect) entry.pass++
  byKind.set(r.corruption, entry)
}

console.log('\n--- by corruption ---')
for (const [kind, { pass, total }] of byKind) {
  console.log(`  ${kind.padEnd(24)} ${pass}/${total}`)
}

const unread = results.filter((r) => !r.parsed)
const missed = results.filter((r) => r.parsed && r.expect === 'caught' && r.got === 'clean')
const falseAlarms = results.filter((r) => r.parsed && r.expect === 'clean' && r.got === 'caught')

console.log(
  `\n${results.length - missed.length - falseAlarms.length - unread.length}/${results.length} correct · ` +
    `${missed.length} missed corruption · ${falseAlarms.length} false alarm · ` +
    `${unread.length} unread verdict`,
)

if (unread.length) {
  console.log('\nUNREAD — no verdict came back; these prove nothing either way:')
  for (const u of unread) {
    console.log(`  q${u.row} ${u.corruption} (stop_reason=${u.stopReason})`)
    console.log(`    raw: ${u.raw.slice(0, 400)}`)
  }
}

if (missed.length) {
  console.log('\nMISSED — the wave said these were faithful:')
  for (const m of missed) console.log(`  q${m.row} ${m.corruption} — said: ${m.detail}`)
}
if (falseAlarms.length) {
  console.log('\nFALSE ALARMS — the wave flagged an untouched row:')
  for (const f of falseAlarms) console.log(`  q${f.row}: ${f.detail}`)
}

// A missed corruption is the failure that matters: it means `verified` can be
// granted to a wrong row. A false alarm costs a reviewer a look.
process.exit(missed.length || unread.length ? 1 : 0)

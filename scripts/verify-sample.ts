// The verification wave, made lookable-at.
//
//   npm run sample:verify            (every ruled-on row)
//   npm run sample:verify -- --ids 458,461,462
//
// Free: it reads rows the wave has already ruled on and renders them locally.
// No model call, nothing written to the database.
//
// Output goes to `local/`, which is gitignored, because every card embeds a crop
// from a commercial book. `sample:corruptions` is the committed companion that
// shows the same comparison on fixtures nobody owns.
//
// It exists because the wave's output is three columns in a table — a boolean,
// a number and a JSON diff — and none of those answer the only question a
// reviewer actually has, which is whether the picture we produced says what the
// book says. So the crop and our render go side by side with the verdict
// underneath, in one self-contained file that opens in a browser.
import { writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import type { ExtractedQuestion } from '../src/core/questions/extraction.ts'
import type { Database } from '../src/types/database.ts'
import { fetchOptionImages, renderQuestion } from '../worker/render-question.ts'
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
const onlyIds = argv.includes('--ids')
  ? (argv[argv.indexOf('--ids') + 1] ?? '').split(',').map(Number).filter(Boolean)
  : null
// Under local/, not samples/: every card embeds a crop from a commercial book.
// The committed, book-free companion is `npm run sample:corruptions`.
const out = argv.includes('--out')
  ? (argv[argv.indexOf('--out') + 1] ?? '')
  : `local/samples/${new Date().toISOString().slice(0, 10)}-verify-wave.html`

const base = db
  .from('questions')
  .select('id, q_no, stem, options, figures, crop_path, crop_mime, verified, verify_confidence, verify_diff, flags')
  .eq('status', 'structured')
  .order('id')
const { data: rows } = onlyIds ? await base.in('id', onlyIds) : await base.not('verified_at', 'is', null)

if (!rows?.length) {
  console.error('no ruled-on rows to show. run the worker first.')
  process.exit(2)
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

interface Diff {
  field: string
  severity: string
  note: string
}

const cards: string[] = []
for (const row of rows) {
  const { data: blob } = await db.storage.from('question-crops').download(row.crop_path)
  const cropUri = blob
    ? `data:${row.crop_mime ?? 'image/png'};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`
    : ''

  const question: ExtractedQuestion = {
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
  const images = await fetchOptionImages(db, question)

  let render = ''
  try {
    // The SVG rather than the PNG: it is smaller than the raster, and it is
    // literally the thing the model was shown.
    render = renderQuestion(question, images).svg
  } catch (error) {
    render = `<p class="err">render failed: ${esc(String(error))}</p>`
  }

  const diffs = (row.verify_diff ?? []) as unknown as Diff[]
  const verdict = row.verified ? 'uyğundur' : 'fərq var'
  const confidence =
    typeof row.verify_confidence === 'number' ? row.verify_confidence.toFixed(2) : '—'

  cards.push(`
<section class="card">
  <header>
    <h2>q${row.id} <span class="qno">№${row.q_no ?? '?'}</span></h2>
    <span class="verdict ${row.verified ? 'ok' : 'bad'}">${verdict}</span>
    <span class="conf">confidence ${confidence}</span>
  </header>
  <div class="pair">
    <figure><figcaption>orijinal</figcaption>${cropUri ? `<img src="${cropUri}" alt="">` : '<p class="err">crop missing</p>'}</figure>
    <figure><figcaption>yenidən yaradılmış</figcaption><div class="render">${render}</div></figure>
  </div>
  ${
    diffs.length
      ? `<ul class="diffs">${diffs
          .map(
            (d) =>
              `<li class="${esc(d.severity)}"><code>${esc(d.field)}</code> <b>${esc(d.severity)}</b> ${esc(d.note)}</li>`,
          )
          .join('')}</ul>`
      : '<p class="none">fərq bildirilmədi</p>'
  }
</section>`)
}

const ruled = rows.length
const passed = rows.filter((r) => r.verified).length

const html = `<!doctype html>
<meta charset="utf-8">
<title>Verify wave — ${ruled} question(s)</title>
<style>
  :root { color-scheme: light dark; --line: #8883; }
  body { font: 15px/1.5 system-ui, sans-serif; margin: 0 auto; padding: 24px; max-width: 1180px; }
  h1 { font-size: 20px; }
  .summary { color: #666; margin-bottom: 24px; }
  .card { border: 1px solid var(--line); border-radius: 10px; padding: 16px; margin-bottom: 22px; }
  header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 12px; }
  h2 { font-size: 16px; margin: 0; }
  .qno { color: #888; font-weight: 400; }
  .verdict { font-size: 12px; padding: 2px 8px; border-radius: 99px; }
  .verdict.ok { background: #12833522; color: #128335; }
  .verdict.bad { background: #d3343622; color: #d33436; }
  .conf { font-size: 12px; color: #888; margin-left: auto; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  figure { margin: 0; min-width: 0; }
  figcaption { font-size: 12px; color: #888; margin-bottom: 6px; }
  img, .render svg { max-width: 100%; height: auto; border: 1px solid var(--line); border-radius: 6px; background: #fff; }
  .render { overflow-x: auto; }
  .diffs { margin: 14px 0 0; padding-left: 18px; font-size: 13px; }
  .diffs li.critical { color: #d33436; }
  .diffs li.minor { color: #a86400; }
  .diffs code { background: #8881; padding: 1px 5px; border-radius: 4px; }
  .none { font-size: 13px; color: #888; margin: 14px 0 0; }
  .err { color: #d33436; font-size: 13px; }
  @media (max-width: 800px) { .pair { grid-template-columns: 1fr; } }
</style>
<h1>Verification wave</h1>
<p class="summary">${ruled} question(s) ruled on · ${passed} matched · ${ruled - passed} flagged for review.
Left is the crop the model read; right is what the pipeline produced from it, rendered by the same
code the wave compared.</p>
${cards.join('\n')}
`

writeFileSync(out, html)
console.log(`${out} — ${ruled} question(s), ${passed} matched, ${ruled - passed} flagged`)

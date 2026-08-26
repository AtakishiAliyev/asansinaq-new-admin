// Original crop, cleaned cut, guarded reproduction — side by side.
//
//   npm run sample:genlane                  every structured row with a figure
//   npm run sample:genlane -- --ids 559,560
//
// COSTS MONEY: one generation per figure, plus a retry when the guard rejects
// the first. Written to local/, gitignored, because every card embeds a page of
// a commercial book.
//
// It exists because the lane's whole question is one a person has to answer by
// looking: the guard can tell you a reproduction kept its shaded regions and
// its lines, and it cannot tell you whether the result is BETTER to read than
// the cut. That judgement is the operator's, and this is the page that puts the
// three side by side and shows the guard's numbers under each one.
import { mkdirSync, writeFileSync } from 'node:fs'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { createClient } from '@supabase/supabase-js'
import { compareStructure } from '@/core/figures/structural-diff'
import type { Pixels } from '@/core/segment/image-clean'
import type { Database } from '@/types/database'
import { guardedReproduction } from '../worker/figure-gen.ts'
import { readEnvFile } from './env-file.ts'

const env = { ...readEnvFile('.env'), ...process.env }
const url = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.')
  process.exit(2)
}
if (!env.GEMINI_API_KEY || !env.GEMINI_IMAGE_MODEL) {
  console.error(
    'GEMINI_API_KEY and GEMINI_IMAGE_MODEL are required for this sample.\n' +
      'Add them to .env (worker-side only — never behind a VITE_ prefix), then\n' +
      're-run. Without them the lane is off by design and every figure stays a cut.',
  )
  process.exit(2)
}
const db = createClient<Database>(url, key, { auth: { persistSession: false } })

const argv = process.argv.slice(2)
const onlyIds = argv.includes('--ids')
  ? (argv[argv.indexOf('--ids') + 1] ?? '').split(',').map(Number).filter(Boolean)
  : null

async function fetchPixels(path: string): Promise<{ png: Buffer; pixels: Pixels } | null> {
  const { data } = await db.storage.from('question-crops').download(path)
  if (!data) return null
  const png = Buffer.from(await data.arrayBuffer())
  const img = await loadImage(png)
  const canvas = createCanvas(img.width, img.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const raw = ctx.getImageData(0, 0, img.width, img.height)
  return { png, pixels: { data: raw.data, width: img.width, height: img.height } }
}

const decode = async (png: Buffer): Promise<Pixels | null> => {
  const img = await loadImage(png)
  const canvas = createCanvas(img.width, img.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const raw = ctx.getImageData(0, 0, img.width, img.height)
  return { data: raw.data, width: img.width, height: img.height }
}

const uri = (png: Buffer) => `data:image/png;base64,${png.toString('base64')}`
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const base = db
  .from('questions')
  .select('id, book_id, page_number, q_no, crop_path, crop_mime, figures')
  .eq('status', 'structured')
  .order('id')
const { data: rows } = onlyIds ? await base.in('id', onlyIds) : await base

const cards: string[] = []
let passed = 0
let attempted = 0

for (const row of rows ?? []) {
  const items = ((row.figures as { items?: { kind: string; src?: string }[] } | null)?.items ?? [])
    .map((item, index) => ({ item, index }))
    .filter((e) => e.item.kind === 'image' && e.item.src)
  if (!items.length) continue

  const crop = await fetchPixels(row.crop_path)

  for (const { item, index } of items) {
    const cut = await fetchPixels(item.src!)
    if (!cut) continue
    attempted++
    const result = await guardedReproduction(cut.png, cut.pixels, decode)
    const diff =
      result.diff ??
      (result.png ? compareStructure(cut.pixels, (await decode(result.png))!) : null)
    if (result.png) passed++

    const numbers = diff
      ? `ink ${diff.inkIoU.toFixed(2)} · ink area ${(diff.inkAreaRatio * 100).toFixed(0)}% · ` +
        `shading ${diff.colourIoU.toFixed(2)} · colour area ${(diff.colourAreaRatio * 100).toFixed(0)}% · ` +
        `elements ${diff.elements.matched}/${diff.elements.inCut}`
      : 'no comparison — nothing came back to compare'

    cards.push(`
<section class="card">
  <h2>q${row.id} <span>book ${row.book_id} · p${row.page_number} · №${row.q_no} · figure ${index}</span></h2>
  <div class="grid">
    <figure><figcaption>orijinal crop</figcaption>${crop ? `<img src="${uri(crop.png)}" alt="">` : '<p class="err">crop missing</p>'}</figure>
    <figure><figcaption>təmizlənmiş kəsim <em>(source of truth)</em></figcaption><img src="${uri(cut.png)}" alt=""></figure>
    <figure>
      <figcaption>1:1 təkrar çəkiliş ${result.png ? '<b class="ok">qəbul edildi</b>' : '<b class="no">rədd edildi</b>'} · ${result.attempts} cəhd</figcaption>
      ${result.png ? `<img src="${uri(result.png)}" alt="">` : `<p class="err">${esc(result.rejection ?? 'no image')}</p>`}
    </figure>
  </div>
  <p class="metrics">${esc(numbers)}</p>
  ${diff && !diff.passed ? `<p class="why">${esc(diff.reasons.join(' · '))}</p>` : ''}
</section>`)
    console.log(
      `q${row.id} fig${index}: ${result.png ? 'PASSED' : 'rejected'} after ${result.attempts} attempt(s)` +
        `${result.rejection ? ` — ${result.rejection}` : ''}`,
    )
  }
}

if (!attempted) {
  console.error('no figure cuts found to reproduce.')
  process.exit(2)
}

const today = new Date().toISOString().slice(0, 10)
const html = `<!doctype html>
<meta charset="utf-8">
<title>Figure reproduction lane — ${today}</title>
<style>
  :root { color-scheme: light dark; --line: #8883; }
  body { font: 15px/1.6 system-ui, sans-serif; margin: 0 auto; padding: 24px; max-width: 1500px; }
  h1 { font-size: 20px; margin-bottom: 6px; }
  .lede { color: #666; margin: 0 0 24px; max-width: 78ch; }
  .card { border: 1px solid var(--line); border-radius: 10px; padding: 16px; margin-bottom: 20px; }
  h2 { font-size: 15px; margin: 0 0 12px; }
  h2 span { color: #888; font-weight: 400; font-size: 12px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  figure { margin: 0; min-width: 0; }
  figcaption { font-size: 11px; color: #888; margin-bottom: 6px; min-height: 2.6em; }
  figcaption em { color: #aaa; }
  img { width: 100%; height: auto; border: 1px solid var(--line); border-radius: 6px; background: #fff; }
  .ok { color: #128335; } .no { color: #d33436; }
  .metrics { font: 11px ui-monospace, monospace; color: #888; margin: 12px 0 0; }
  .why { color: #d33436; font-size: 12px; margin: 4px 0 0; }
  .err { color: #d33436; font-size: 12px; }
  @media (max-width: 1000px) { .grid { grid-template-columns: 1fr; } }
</style>
<h1>Figure reproduction lane</h1>
<p class="lede">Left is the page. Middle is the cleaned cut, which is the source of truth and the
fallback. Right is the 1:1 reproduction, shown only where it PASSED the structural guard — the
numbers under each card are what the guard measured.
<br><br>
The guard is deliberately asymmetric: loose about where lines end, because a guide stopping short of
an axis is harmless and rejecting it would reject every reproduction; strict about shaded regions and
colour, because which region is shaded is the question itself. It does not read labels — there is no
OCR here — so text is left to the verification wave.
<br><br>
<strong>${passed} of ${attempted} reproduction(s) passed.</strong> The guard can say a reproduction
kept the figure. Whether it is nicer to read than the cut is the judgement being asked for here.</p>
${cards.join('\n')}
`

mkdirSync('local/samples', { recursive: true })
const out = `local/samples/${today}-figure-gen-lane.html`
writeFileSync(out, html)
console.log(`\n${out} — ${passed}/${attempted} passed`)

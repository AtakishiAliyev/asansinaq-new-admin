// Can a scanned crop be cleaned well enough to USE as the figure?
//
//   npm run probe:dewatermark
//
// A feasibility test, not a feature. It decides one question: if the watermark
// and the bleed-through can be removed without eating the strokes, then for
// clean-ish books the source crop itself could be the figure — no vector DSL, no
// model call, no possibility of hallucination — and the DSL would be reserved
// for the books where cleaning fails. That is a large enough change to the
// pipeline that it should be argued from pictures rather than from a claim.
//
// Free and offline: no model call. Output goes under `local/`, gitignored,
// because every input is a page of a commercial book.
//
// Nothing here changes figure policy. It only produces the before/after.
import { mkdirSync, writeFileSync } from 'node:fs'
import { createCanvas, loadImage } from '@napi-rs/canvas'
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

interface Pix {
  data: Uint8ClampedArray
  width: number
  height: number
}

const lumAt = (d: Uint8ClampedArray, i: number): number =>
  0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!

/** HSV saturation, 0 for a perfectly grey pixel. */
function satAt(d: Uint8ClampedArray, i: number): number {
  const r = d[i]!
  const g = d[i + 1]!
  const b = d[i + 2]!
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  return max === 0 ? 0 : (max - min) / max
}

/**
 * Mean luminance of the WxW box around every pixel, via a summed-area table.
 *
 * The window has to be much wider than a watermark stroke. Too narrow and the
 * local mean sits inside the watermark itself, which then looks like ink
 * against its own background and survives the threshold — the failure that
 * makes naive adaptive thresholding look like it does nothing.
 */
function localMean(pix: Pix, window: number): Float64Array {
  const { width: w, height: h, data } = pix
  const sum = new Float64Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) {
    let row = 0
    for (let x = 0; x < w; x++) {
      row += lumAt(data, (y * w + x) * 4)
      sum[(y + 1) * (w + 1) + (x + 1)] = sum[y * (w + 1) + (x + 1)]! + row
    }
  }
  const r = Math.max(1, Math.floor(window / 2))
  const out = new Float64Array(w * h)
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r)
    const y1 = Math.min(h - 1, y + r)
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r)
      const x1 = Math.min(w - 1, x + r)
      const area = (y1 - y0 + 1) * (x1 - x0 + 1)
      const total =
        sum[(y1 + 1) * (w + 1) + (x1 + 1)]! -
        sum[y0 * (w + 1) + (x1 + 1)]! -
        sum[(y1 + 1) * (w + 1) + x0]! +
        sum[y0 * (w + 1) + x0]!
      out[y * w + x] = total / area
    }
  }
  return out
}

/** Otsu's threshold over the luminance histogram. */
function otsu(pix: Pix): number {
  const hist = new Array(256).fill(0)
  for (let i = 0; i < pix.data.length; i += 4) hist[Math.round(lumAt(pix.data, i))]++
  const total = pix.data.length / 4
  let sum = 0
  for (let t = 0; t < 256; t++) sum += t * hist[t]
  let sumB = 0
  let wB = 0
  let best = 0
  let bestVar = -1
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (!wB) continue
    const wF = total - wB
    if (!wF) break
    sumB += t * hist[t]
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > bestVar) {
      bestVar = between
      best = t
    }
  }
  return best
}

type Cleaner = (pix: Pix) => Pix

const clone = (pix: Pix): Pix => ({
  data: new Uint8ClampedArray(pix.data),
  width: pix.width,
  height: pix.height,
})

/** Global Otsu on luminance. The naive baseline, included to be beaten. */
const globalOtsu: Cleaner = (pix) => {
  const out = clone(pix)
  const t = otsu(pix)
  for (let i = 0; i < out.data.length; i += 4) {
    const v = lumAt(out.data, i) < t ? 0 : 255
    out.data[i] = out.data[i + 1] = out.data[i + 2] = v
    out.data[i + 3] = 255
  }
  return out
}

/**
 * Ink is what is meaningfully darker than its own neighbourhood.
 *
 * A watermark sits at nearly the same level as the paper around it, so it fails
 * the margin; a printed stroke is far darker than the white it sits on and
 * passes. Bleed-through from the reverse side is faint for the same reason and
 * goes with the watermark.
 */
const adaptive =
  (window: number, margin: number): Cleaner =>
  (pix) => {
    const out = clone(pix)
    const mean = localMean(pix, window)
    for (let p = 0; p < pix.width * pix.height; p++) {
      const i = p * 4
      const v = lumAt(pix.data, i) < mean[p]! - margin ? 0 : 255
      out.data[i] = out.data[i + 1] = out.data[i + 2] = v
      out.data[i + 3] = 255
    }
    return out
  }

/**
 * The same margin test, but colour survives it.
 *
 * Necessary because in these books the colour IS the question: an IQ item whose
 * answer is the order of a red, a green and a black circle does not survive
 * being flattened to black and white. So a pixel that is saturated enough to be
 * a deliberate colour is kept as it is, and only the near-grey pixels — paper,
 * grey watermark text, bleed-through, black print — go through the threshold.
 */
const adaptiveColor =
  (window: number, margin: number, keepSat: number): Cleaner =>
  (pix) => {
    const out = clone(pix)
    const mean = localMean(pix, window)
    for (let p = 0; p < pix.width * pix.height; p++) {
      const i = p * 4
      out.data[i + 3] = 255
      if (satAt(pix.data, i) >= keepSat && lumAt(pix.data, i) < 245) continue
      const v = lumAt(pix.data, i) < mean[p]! - margin ? 0 : 255
      out.data[i] = out.data[i + 1] = out.data[i + 2] = v
    }
    return out
  }

/**
 * The same colour-preserving test, plus an absolute floor on what may become
 * ink.
 *
 * Needed because "remove the watermark" and "turn the watermark into ink" both
 * score as removal on a pale-pixel count. On the logo pages the local-contrast
 * test promoted the darker EDGES of the logo script to solid black — a pale
 * wash reads as background to a reader and to a model, and a solid black arc
 * reads as a drawn stroke, which on a Venn diagram is the content itself.
 *
 * The two populations are far apart: real print on these scans sits at
 * luminance 0-19 and the wash at 200-239, with only anti-aliasing between. So a
 * pixel must be BOTH darker than its neighbourhood and darker than print
 * plausibly is. The cost is that a genuinely light-grey printed element would
 * be dropped; in these books print is black.
 */
const adaptiveColorFloor =
  (window: number, margin: number, keepSat: number, ceiling: number): Cleaner =>
  (pix) => {
    const out = clone(pix)
    const mean = localMean(pix, window)
    for (let p = 0; p < pix.width * pix.height; p++) {
      const i = p * 4
      out.data[i + 3] = 255
      const lum = lumAt(pix.data, i)
      if (satAt(pix.data, i) >= keepSat && lum < 245) continue
      const v = lum < mean[p]! - margin && lum < ceiling ? 0 : 255
      out.data[i] = out.data[i + 1] = out.data[i + 2] = v
    }
    return out
  }

const VARIANTS: { name: string; note: string; run: Cleaner }[] = [
  {
    name: 'global otsu',
    note: 'One threshold for the whole crop — the naive baseline.',
    run: globalOtsu,
  },
  {
    name: 'adaptive 61/12',
    note: 'Ink is what is darker than its own neighbourhood by 12 levels.',
    run: adaptive(61, 12),
  },
  {
    name: 'adaptive 61/12, colour kept',
    note: 'Same test, but a saturated pixel is left alone — the colour is the question.',
    run: adaptiveColor(61, 12, 0.28),
  },
  {
    name: '+ ink floor (lum < 150) — SHIPPED',
    note:
      'Colour kept, and nothing lighter than real print may become ink — the logo edges ' +
      'stop being promoted to black strokes. This is what core/segment/image-clean.ts now does.',
    run: adaptiveColorFloor(61, 12, 0.28, 150),
  },
]

interface Target {
  path: string
  source: string
  watermark: string
}

const TARGETS: Target[] = [
  { path: '23/p11_c0_q7.jpg', source: 'FEM GEOMETRİ', watermark: 'bleed-through from the reverse side' },
  { path: '23/p11_c1_q10.jpg', source: 'FEM GEOMETRİ', watermark: 'bleed-through from the reverse side' },
  { path: '24/p9_c1_q36.png', source: 'Golden Group IQ', watermark: 'grey repeated text ("GOLDEN GROUP")' },
  { path: '24/p9_c0_q32.png', source: 'Golden Group IQ', watermark: 'grey repeated text ("GOLDEN GROUP")' },
  { path: '24/p9_c1_q35.png', source: 'Golden Group IQ', watermark: 'grey repeated text ("GOLDEN GROUP")' },
  { path: '22/p7_c1_q4.png', source: 'Soru Bankası 2025 A', watermark: 'text-only page, for a control' },
  {
    path: '22/p302_c1_q11.png',
    source: 'Saveh oca (p302, test 4, №11)',
    watermark: 'coloured logo over a shaded Venn — the case saturation-keeping is weakest on',
  },
  {
    path: '22/p302_c1_q12.png',
    source: 'Saveh oca (p302, test 4, №12)',
    watermark: 'coloured logo over a shaded Venn — the case saturation-keeping is weakest on',
  },
]

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function toPix(image: Awaited<ReturnType<typeof loadImage>>): Pix {
  const canvas = createCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, 0, 0)
  const raw = ctx.getImageData(0, 0, image.width, image.height)
  return { data: raw.data, width: image.width, height: image.height }
}

function toDataUri(pix: Pix): string {
  const canvas = createCanvas(pix.width, pix.height)
  const ctx = canvas.getContext('2d')
  const img = ctx.createImageData(pix.width, pix.height)
  img.data.set(pix.data)
  ctx.putImageData(img, 0, 0)
  return `data:image/png;base64,${canvas.toBuffer('image/png').toString('base64')}`
}

/** How much ink survived, as a fraction. A cleaner that eats the strokes shows
 *  up here as a number far below the original's. */
const inkRatio = (pix: Pix): number => {
  let dark = 0
  const n = pix.width * pix.height
  for (let p = 0; p < n; p++) if (lumAt(pix.data, p * 4) < 128) dark++
  return dark / n
}

const lightness = (d: Uint8ClampedArray, i: number): number =>
  (Math.max(d[i]!, d[i + 1]!, d[i + 2]!) + Math.min(d[i]!, d[i + 1]!, d[i + 2]!)) / 510

/**
 * The two things that have to be told apart on a logo-watermarked page, counted
 * separately.
 *
 * A single "colour %" cannot answer the question, because the watermark is
 * coloured too — it would rise when the cleaner fails and rise when it
 * succeeds. `content` counts strongly saturated pixels, which on these pages is
 * the shaded region the question is ABOUT; `wash` counts the pale tint the logo
 * is printed in. A working cleaner keeps the first and removes the second.
 */
/**
 * Ink that was not there before.
 *
 * The measurement this page was missing. A pale-pixel count says a watermark is
 * gone whether it was erased or turned black, because a promoted pixel simply
 * moves into the ink bucket and becomes indistinguishable from print. Counting
 * pixels that are black NOW and were pale BEFORE names the difference, and it
 * is the number that matters: invented strokes on a diagram are worse than the
 * faint marks they replaced.
 */
function fakeInk(before: Pix, after: Pix): number {
  let promoted = 0
  const n = before.width * before.height
  for (let p = 0; p < n; p++) {
    const i = p * 4
    if (lumAt(after.data, i) >= 128) continue
    if (satAt(before.data, i) >= 0.35) continue
    if (lumAt(before.data, i) >= 190) promoted++
  }
  return promoted / n
}

function contentAndWash(pix: Pix): { content: number; wash: number } {
  let content = 0
  let wash = 0
  const n = pix.width * pix.height
  for (let p = 0; p < n; p++) {
    const i = p * 4
    const s = satAt(pix.data, i)
    const l = lightness(pix.data, i)
    if (s >= 0.5 && l < 0.9) content++
    else if (s >= 0.06 && s < 0.3 && l >= 0.82) wash++
  }
  return { content: content / n, wash: wash / n }
}

const cards: string[] = []
for (const target of TARGETS) {
  const { data: blob } = await db.storage.from('question-crops').download(target.path)
  if (!blob) {
    console.warn(`missing: ${target.path}`)
    continue
  }
  const image = await loadImage(Buffer.from(await blob.arrayBuffer()))
  const pix = toPix(image)
  const originalInk = inkRatio(pix)

  const base = contentAndWash(pix)
  const pct = (v: number) => `${(v * 100).toFixed(2)}%`
  const rows = [
    `<tr><th>orijinal</th><td>${pct(originalInk)}</td><td>${pct(base.content)}</td><td>${pct(base.wash)}</td><td>—</td><td>—</td><td>—</td></tr>`,
  ]
  const panels = [
    `<figure><figcaption>orijinal</figcaption><img src="${toDataUri(pix)}" alt=""></figure>`,
  ]
  for (const variant of VARIANTS) {
    const started = process.hrtime.bigint()
    const cleaned = variant.run(pix)
    const ms = Number(process.hrtime.bigint() - started) / 1e6
    const after = contentAndWash(cleaned)
    const invented = fakeInk(pix, cleaned)
    const kept = base.content > 0 ? after.content / base.content : 1
    const left = base.wash > 0 ? after.wash / base.wash : 0
    rows.push(
      `<tr><th>${esc(variant.name)}</th><td>${pct(inkRatio(cleaned))}</td><td>${pct(after.content)}</td>` +
        `<td>${pct(after.wash)}</td>` +
        `<td class="${kept > 0.9 ? 'good' : 'bad'}">${(kept * 100).toFixed(0)}%</td>` +
        `<td class="${left < 0.1 ? 'good' : 'bad'}">${(left * 100).toFixed(0)}%</td>` +
        `<td class="${invented < 0.001 ? 'good' : 'bad'}">${pct(invented)}</td></tr>`,
    )
    panels.push(
      `<figure><figcaption>${esc(variant.name)} · ${ms.toFixed(0)}ms` +
        `<br><span class="sub">${esc(variant.note)}</span></figcaption>` +
        `<img src="${toDataUri(cleaned)}" alt=""></figure>`,
    )
  }

  cards.push(`
<section class="card">
  <h2>${esc(target.source)} <code>${esc(target.path)}</code></h2>
  <p class="wm">watermark: ${esc(target.watermark)} · ${image.width}×${image.height}px</p>
  <div class="grid">${panels.join('')}</div>
  <table>
    <thead><tr><th></th><th>ink</th><th>content colour</th><th>pale wash</th>
      <th>content kept</th><th>wash left</th><th>invented ink</th></tr></thead>
    <tbody>${rows.join('')}</tbody>
  </table>
</section>`)
  console.log(`${target.path} — ${image.width}x${image.height}, ink ${(originalInk * 100).toFixed(1)}%`)
}

const today = new Date().toISOString().slice(0, 10)
const html = `<!doctype html>
<meta charset="utf-8">
<title>De-watermark feasibility — ${today}</title>
<style>
  :root { color-scheme: light dark; --line: #8883; }
  body { font: 15px/1.6 system-ui, sans-serif; margin: 0 auto; padding: 24px; max-width: 1500px; }
  h1 { font-size: 20px; margin-bottom: 6px; }
  .lede { color: #666; margin: 0 0 24px; max-width: 78ch; }
  .card { border: 1px solid var(--line); border-radius: 10px; padding: 16px; margin-bottom: 20px; }
  h2 { font-size: 15px; margin: 0 0 2px; }
  h2 code { font-size: 12px; color: #888; font-weight: 400; }
  .wm { color: #888; font-size: 12px; margin: 0 0 12px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; }
  figure { margin: 0; min-width: 0; }
  figcaption { font-size: 11px; color: #888; margin-bottom: 6px; min-height: 3.2em; }
  .sub { color: #aaa; }
  img { width: 100%; height: auto; border: 1px solid var(--line); border-radius: 6px; background: #fff; }
  table { border-collapse: collapse; margin-top: 14px; font-size: 12px; width: 100%; }
  th, td { border: 1px solid var(--line); padding: 4px 8px; text-align: right; }
  thead th { color: #888; font-weight: 500; }
  tbody th { text-align: left; font-weight: 500; }
  td.good { color: #128335; }
  td.bad { color: #d33436; font-weight: 600; }
</style>
<h1>De-watermark feasibility</h1>
<p class="lede">Pure image processing — no model call. The question is whether the watermark and the
bleed-through can be removed without eating the strokes. If they can, then for clean-ish books the
source crop could BE the figure, with the vector DSL reserved for the books where cleaning fails.
<strong>“ink %” is the share of pixels darker than mid-grey</strong>: a cleaner that drops far below the
original has eaten the drawing, not just the watermark.
<br><br>
On a logo-watermarked page a single colour count answers nothing, because the watermark is coloured too —
it would rise whether the cleaner worked or failed. So colour is counted twice: <strong>content colour</strong>
is strongly saturated pixels, which on these pages is the shaded region the question is about, and
<strong>pale wash</strong> is the light tint the logo is printed in. A working cleaner keeps the first
column near 100% and drives the second near 0%.
<br><br>
<strong>“invented ink”</strong> is the column that matters most and the one this page originally lacked:
pixels that are black NOW and were pale BEFORE. Erasing a watermark and turning it into a stroke both
read as removal on a pale-pixel count, because a promoted pixel just moves into the ink bucket. On a Venn
diagram an invented stroke is worse than the faint mark it replaced. Nothing here changes figure policy.</p>
${cards.join('\n')}
`

mkdirSync('local/samples', { recursive: true })
const out = `local/samples/${today}-dewatermark.html`
writeFileSync(out, html)
console.log(`\n${out}`)

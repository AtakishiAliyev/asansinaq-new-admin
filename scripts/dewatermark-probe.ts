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

  const panels = [
    `<figure><figcaption>orijinal · ink ${(originalInk * 100).toFixed(1)}%</figcaption><img src="${toDataUri(pix)}" alt=""></figure>`,
  ]
  for (const variant of VARIANTS) {
    const started = process.hrtime.bigint()
    const cleaned = variant.run(pix)
    const ms = Number(process.hrtime.bigint() - started) / 1e6
    const ink = inkRatio(cleaned)
    panels.push(
      `<figure><figcaption>${esc(variant.name)} · ink ${(ink * 100).toFixed(1)}% · ${ms.toFixed(0)}ms` +
        `<br><span class="sub">${esc(variant.note)}</span></figcaption>` +
        `<img src="${toDataUri(cleaned)}" alt=""></figure>`,
    )
  }

  cards.push(`
<section class="card">
  <h2>${esc(target.source)} <code>${esc(target.path)}</code></h2>
  <p class="wm">watermark: ${esc(target.watermark)} · ${image.width}×${image.height}px</p>
  <div class="grid">${panels.join('')}</div>
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
</style>
<h1>De-watermark feasibility</h1>
<p class="lede">Pure image processing — no model call. The question is whether the watermark and the
bleed-through can be removed without eating the strokes. If they can, then for clean-ish books the
source crop could BE the figure, with the vector DSL reserved for the books where cleaning fails.
<strong>“ink %” is the share of pixels darker than mid-grey</strong>: a cleaner that drops far below the
original has eaten the drawing, not just the watermark. Nothing here changes figure policy.</p>
${cards.join('\n')}
`

mkdirSync('local/samples', { recursive: true })
const out = `local/samples/${today}-dewatermark.html`
writeFileSync(out, html)
console.log(`\n${out}`)

// What the generation guard accepts and what it refuses, on fixtures.
//
// The companion to `sample:genlane`, which cannot be committed because every
// card on it is a page of a commercial book. This one draws its own figures, so
// it can live in the repo — and it is the page that actually shows the
// calibration, because each pair is one class of difference held on its own
// while everything else is kept identical.
//
// Free and offline: no model call, no network, no key.
import { mkdirSync, writeFileSync } from 'node:fs'
import { createCanvas } from '@napi-rs/canvas'
import { compareStructure } from '@/core/figures/structural-diff'
import type { Pixels } from '@/core/segment/image-clean'

const W = 240
const H = 240
type RGB = [number, number, number]
const BLACK: RGB = [20, 20, 20]
const RED: RGB = [230, 40, 30]
const BLUE: RGB = [40, 70, 210]

const blank = (w = W, h = H): Pixels => ({
  data: new Uint8ClampedArray(w * h * 4).fill(255),
  width: w,
  height: h,
})

function draw(p: Pixels, x0: number, y0: number, x1: number, y1: number, rgb: RGB): void {
  for (let y = Math.max(0, y0); y <= Math.min(p.height - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(p.width - 1, x1); x++) {
      const i = (y * p.width + x) * 4
      p.data[i] = rgb[0]
      p.data[i + 1] = rgb[1]
      p.data[i + 2] = rgb[2]
      p.data[i + 3] = 255
    }
  }
}

/** Axes, a guide to the axis, a shaded block. The stand-in for a real figure. */
function chart(scale = 1, pen = 3, opts: { guide?: boolean; shade?: RGB } = {}): Pixels {
  const s = (v: number) => Math.round(v * scale)
  const p = blank(W * scale, H * scale)
  draw(p, s(24), s(200), s(216), s(200) + pen, BLACK)
  draw(p, s(24), s(36), s(24) + pen, s(200), BLACK)
  if (opts.guide !== false) draw(p, s(28), s(72), s(150), s(72) + pen, BLACK)
  draw(p, s(72), s(120), s(168), s(180), opts.shade ?? RED)
  return p
}

/** A figure carrying its meaning in colour, with only a number in black. */
function colourOnly(opts: { second?: boolean; label?: number } = {}): Pixels {
  const p = blank()
  draw(p, 36, 36, 204, 108, RED)
  if (opts.second !== false) draw(p, 36, 132, 204, 204, BLUE)
  const x = opts.label ?? 6
  draw(p, x, 6, x + 7, 16, BLACK)
  return p
}

const png = (p: Pixels): string => {
  const c = createCanvas(p.width, p.height)
  const ctx = c.getContext('2d')
  const img = ctx.createImageData(p.width, p.height)
  img.data.set(p.data)
  ctx.putImageData(img, 0, 0)
  return `data:image/png;base64,${c.toBuffer('image/png').toString('base64')}`
}

interface Case {
  title: string
  why: string
  expect: 'pass' | 'fail'
  cut: Pixels
  gen: Pixels
}

const cases: Case[] = [
  {
    title: 'the same figure, a thinner pen',
    why:
      'A reproduction is drawn larger and crisper than the scan it came from. ' +
      'Comparing inked MASS read that as losing up to 60% of the drawing and ' +
      'rejected six of eight faithful figures; strokes are compared as skeletons.',
    expect: 'pass',
    cut: chart(1, 5),
    gen: chart(1, 1),
  },
  {
    title: 'a thinner pen, and a line dropped',
    why:
      'The other half of the same claim. Tolerating stroke weight must not ' +
      'tolerate a missing guide — and because this guide touches an axis, the ' +
      'two merge into one component and overlap is the only check that sees it.',
    expect: 'fail',
    cut: chart(1, 5),
    gen: chart(1, 1, { guide: false }),
  },
  {
    title: 'a reproduction drawn three times larger',
    why:
      'The comparison happens on the cut’s grid, with an area-preserving ' +
      'downscale. Nearest-neighbour dropped thin strokes on the way down and ' +
      'manufactured the very ink loss it then reported.',
    expect: 'pass',
    cut: chart(1, 3),
    gen: chart(3, 4),
  },
  {
    title: 'a guide that stops short of the axis',
    why:
      'The defect in the operator’s own sample. Harmless — the guide still ' +
      'says which point is meant — and strictness here would reject every ' +
      'reproduction over a few pixels of endpoint drift.',
    expect: 'pass',
    cut: chart(),
    gen: (() => {
      const p = blank()
      draw(p, 24, 200, 216, 203, BLACK)
      draw(p, 24, 36, 27, 200, BLACK)
      draw(p, 40, 72, 150, 75, BLACK) // starts short of the y axis
      draw(p, 72, 120, 168, 180, RED)
      return p
    })(),
  },
  {
    title: 'a shaded region that moved',
    why:
      'Which region is shaded IS the question in these books, so colour is ' +
      'checked with a fraction of the tolerance given to lines.',
    expect: 'fail',
    cut: chart(),
    gen: (() => {
      const p = chart()
      draw(p, 72, 120, 168, 180, [255, 255, 255])
      draw(p, 100, 130, 196, 190, RED)
      return p
    })(),
  },
  {
    title: 'a hue that straddles the wrap point',
    why:
      'Red sits on the seam of the hue wheel: 5° in the scan and 355° in the ' +
      'reproduction is a ten-degree difference that 45°-wide buckets scored as ' +
      'half the palette moving. Buckets are 10° and the distance is circular.',
    expect: 'pass',
    cut: chart(1, 3, { shade: [230, 40, 30] }),
    gen: chart(1, 3, { shade: [230, 30, 40] }),
  },
  {
    title: 'a region repainted',
    why: 'And the same measure still refuses a real recolour outright.',
    expect: 'fail',
    cut: chart(1, 3, { shade: RED }),
    gen: chart(1, 3, { shade: BLUE }),
  },
  {
    title: 'a figure drawn in colour, labels redrawn',
    why:
      'The black channel here is a question number — 57 pixels of skeleton on ' +
      'the live rows. The ink checks ABSTAIN rather than judge labels the guard ' +
      'openly does not read, and report inkMeasurable: false.',
    expect: 'pass',
    cut: colourOnly(),
    gen: colourOnly({ label: 7 }),
  },
  {
    title: 'a figure drawn in colour, a region lost',
    why:
      'Abstaining on ink is not abstaining. The strict colour checks carry such ' +
      'a figure alone, and they still refuse it.',
    expect: 'fail',
    cut: colourOnly(),
    gen: colourOnly({ second: false }),
  },
]

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
let agreed = 0
const cards = cases.map((c) => {
  const d = compareStructure(c.cut, c.gen)
  const got = d.passed ? 'pass' : 'fail'
  if (got === c.expect) agreed++
  return `
<section class="card ${got}">
  <h2>${esc(c.title)} <span class="verdict">${d.passed ? 'qəbul edildi' : 'rədd edildi'}</span></h2>
  <p class="why">${esc(c.why)}</p>
  <div class="pair">
    <figure><figcaption>kəsim</figcaption><img src="${png(c.cut)}" alt=""></figure>
    <figure><figcaption>təkrar çəkiliş</figcaption><img src="${png(c.gen)}" alt=""></figure>
  </div>
  <p class="metrics">ink ${d.inkIoU.toFixed(2)}${d.inkMeasurable ? '' : ' (ölçülmür)'} ·
    shading ${d.colourIoU.toFixed(2)} · colour area ${(d.colourAreaRatio * 100).toFixed(0)}% ·
    elements ${d.elements.matched}/${d.elements.inCut} · palette ${d.hueAgreement.toFixed(2)}</p>
  ${d.reasons.length ? `<p class="reasons">${esc(d.reasons.join(' · '))}</p>` : ''}
</section>`
})

const html = `<!doctype html>
<meta charset="utf-8">
<title>Təkrar çəkiliş qoruyucusu — kalibrasiya</title>
<style>
  body { font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; background: #14161a; color: #e6e6e6;
         margin: 0; padding: 32px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .lede { color: #9aa0a6; max-width: 62ch; margin: 0 0 28px; }
  .card { border: 1px solid #2a2f36; border-radius: 10px; padding: 16px; margin-bottom: 18px;
          background: #191c21; }
  .card.pass { border-left: 4px solid #3f9d58; }
  .card.fail { border-left: 4px solid #b4402f; }
  h2 { font-size: 15px; margin: 0 0 6px; font-weight: 600; }
  .verdict { font-size: 11px; color: #9aa0a6; font-weight: 400; }
  .why { color: #9aa0a6; margin: 0 0 12px; max-width: 78ch; }
  .pair { display: flex; gap: 14px; flex-wrap: wrap; }
  figure { margin: 0; }
  figcaption { font-size: 11px; color: #777; margin-bottom: 4px; }
  img { background: #fff; border-radius: 6px; width: 240px; height: 240px; max-width: 100%;
        image-rendering: pixelated; }
  .metrics { font-family: ui-monospace, monospace; font-size: 11px; color: #7d848c; margin: 10px 0 0; }
  .reasons { font-size: 12px; color: #d98b7a; margin: 4px 0 0; }
</style>
<h1>Təkrar çəkiliş qoruyucusu — kalibrasiya</h1>
<p class="lede">Hər cütdə yalnız BİR fərq var. Qoruyucunun məzmunu ölçdüyünü,
  çəkiliş üsulunu deyil — və sərtliyini itirmədiyini göstərir.
  ${agreed}/${cases.length} gözlənilən nəticə.</p>
${cards.join('\n')}
`

mkdirSync('samples', { recursive: true })
const out = 'samples/2026-08-26-guard-calibration.html'
writeFileSync(out, html)
console.log(`${out} — ${agreed}/${cases.length} as expected`)

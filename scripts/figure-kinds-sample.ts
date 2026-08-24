// Every FigSpec kind, drawn by core.
//
//   npm run sample:kinds
//
// Free and offline. No model call, no database, no book content, so it is
// committed under `samples/` and a reviewer can open it from the repo.
//
// It exists as a SCRIPT rather than a one-off file because the first version
// was hand-produced and went stale in a way nobody could see: it kept claiming
// that marks are carried as data while the congruence arc it drew was
// byte-identical to a bare label anchor, and it predated the fix that made the
// distinction visible at all. A sample that cannot be regenerated is a
// screenshot of an old build with a current date on it.
import { writeFileSync } from 'node:fs'
import { createCanvas } from '@napi-rs/canvas'
import type { FigItem } from '@/core/figures/figspec'
import { renderFigItem } from '@/core/figures/render'
import { mathjaxRenderer } from '../worker/tex-mathjax.ts'

/**
 * A stand-in for a region cut out of a scanned page.
 *
 * Drawn here rather than copied from a book: the `image` kind exists for
 * figures that cannot be vectorised, and every real example of one is
 * copyrighted. What the sample has to show is that the cut is drawn at its own
 * proportions, which a deliberately non-square placeholder does.
 */
function placeholderCut(): { uri: string; w: number; h: number } {
  const w = 260
  const h = 96
  const canvas = createCanvas(w, h)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#f4f1ea'
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = '#1A1A1A'
  ctx.lineWidth = 2
  for (let i = 0; i < 3; i++) {
    ctx.beginPath()
    ctx.arc(50 + i * 80, 48, 26, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(24 + i * 80, 22)
    ctx.lineTo(76 + i * 80, 74)
    ctx.stroke()
  }
  return { uri: `data:image/png;base64,${canvas.toBuffer('image/png').toString('base64')}`, w, h }
}

const cut = placeholderCut()

interface Sample {
  kind: string
  note: string
  item: FigItem
}

const SAMPLES: Sample[] = [
  {
    kind: 'geometry',
    note:
      'Two rays from a vertex with congruent arcs — the bisector figure. The arcs carry a hatch tick ' +
      'BECAUSE they are a congruence claim: a labelled angle also gets an arc, and while the two were ' +
      'drawn identically, deleting the claim that two angles are equal changed nothing on screen and ' +
      'the verification wave could not possibly catch it.',
    item: {
      kind: 'geometry',
      width: 300,
      height: 200,
      points: [
        { id: 'O', x: 20, y: 180, label: 'O', dot: true },
        { id: 'A', x: 280, y: 180, label: 'A' },
        { id: 'B', x: 220, y: 60, label: 'B' },
        { id: 'C', x: 120, y: 20, label: 'C' },
      ],
      lines: [
        { from: 'O', to: 'A', kind: 'ray' },
        { from: 'O', to: 'B', kind: 'ray' },
        { from: 'O', to: 'C', kind: 'ray' },
      ],
      angles: [
        { at: ['A', 'O', 'B'], label: '30°', arcs: 1 },
        { at: ['B', 'O', 'C'], label: '30°', arcs: 1 },
      ],
    },
  },
  {
    kind: 'geometry',
    note: 'Equal-length ticks and a right angle, sized against the figure rather than in fixed pixels.',
    item: {
      kind: 'geometry',
      width: 320,
      height: 240,
      points: [
        { id: 'A', x: 40, y: 200, label: 'A', dot: true },
        { id: 'B', x: 280, y: 200, label: 'B', dot: true },
        { id: 'C', x: 160, y: 40, label: 'C', dot: true },
        { id: 'H', x: 160, y: 200, label: 'H', dot: true },
      ],
      lines: [
        { from: 'A', to: 'B' },
        { from: 'A', to: 'C', ticks: 1 },
        { from: 'B', to: 'C', ticks: 1 },
        { from: 'C', to: 'H', dashed: true },
      ],
      angles: [
        { at: ['A', 'C', 'B'], label: '\\alpha' },
        { at: ['C', 'H', 'B'], right: true },
      ],
    },
  },
  {
    kind: 'cubes',
    note:
      'Isometric cubes coloured by a rule, with the last one lettered — a genre of its own in the IQ ' +
      'sections. Left to raw_svg the model drew this as three polygons and a circle per cube, where a ' +
      'face colour that came back wrong is indistinguishable from one it chose to draw differently. ' +
      'As data it is three fields and a reviewer can fix it in a dropdown.',
    item: {
      kind: 'cubes',
      cubes: [
        { front: { dot: '#2255cc' }, top: { dot: '#33aa55' }, right: { dot: '#eecc33' } },
        { front: { dot: '#dd3322' }, top: { dot: '#3355bb' }, right: { dot: '#eecc33' } },
        { front: { dot: '#33aa55' }, top: { dot: '#dd3322' }, right: { dot: '#2255cc' } },
        { front: { label: 'A' }, top: { label: 'B' }, right: { label: 'C' } },
      ],
    },
  },
  {
    kind: 'image',
    note:
      'A region cut out of the ORIGINAL crop, for a figure no vector kind can express. It is the honest ' +
      'escape: left with only raw_svg, a model facing an undrawable figure writes an apology INTO the ' +
      'drawing — one live row came back as a single line of text reading "text description not possible". ' +
      'Drawn at the natural size of the cut, because a stretched copy of the source is a difference the ' +
      'verification wave would report against the source it was cut from. (Placeholder here: every real ' +
      'example is book content.)',
    item: { kind: 'image', src: cut.uri, w: cut.w, h: cut.h },
  },
  {
    kind: 'venn',
    note:
      'The shaded region is COMPILED from the set expression "(A∩B)-C" into a chain of SVG masks — ' +
      'intersection nests, union paints twice, complement inverts. Nothing here eyeballs a shape and ' +
      'shades what looks about right.',
    item: {
      kind: 'venn',
      width: 320,
      height: 240,
      shapes: [
        { id: 'A', label: 'A', geom: { type: 'circle', cx: 120, cy: 110, r: 70 } },
        { id: 'B', label: 'B', geom: { type: 'circle', cx: 200, cy: 110, r: 70 } },
        { id: 'C', label: 'C', geom: { type: 'circle', cx: 160, cy: 175, r: 70 } },
      ],
      shaded: ['(A∩B)-C'],
      universe: { label: 'E' },
      regionLabels: [
        { expr: 'A-B-C', tex: '2' },
        { expr: '(A∩B)-C', tex: '1, 2, a' },
        { expr: 'C-A-B', tex: '3' },
      ],
    } as FigItem,
  },
  {
    kind: 'function_graph',
    note:
      'Curve samples come from core/figures/curve.ts — the same samples lint uses to decide whether a ' +
      'marked point lies on its curve, so a figure cannot pass lint and then render differently.',
    item: {
      kind: 'function_graph',
      panels: [
        {
          x: { min: -3, max: 3, ticks: [{ at: -2, tex: '-2' }, { at: 2, tex: '2' }] },
          y: { min: -1, max: 5, ticks: [{ at: 4, tex: '4' }] },
          grid: 'dotted',
          curves: [
            {
              id: 'p',
              color: 'primary',
              def: { type: 'expr', expr: 'x^2', domain: [-2.2, 2.2] },
              label: { tex: 'y=x^2', at: [1.7, 3.4] },
            },
          ],
          points: [{ x: 2, y: 4, style: 'dot', label: 'P' }],
        },
      ],
    },
  },
  {
    kind: 'table',
    note: 'Was an HTML <table>. Columns sized to their widest cell, measured through the injected text renderer.',
    item: {
      kind: 'table',
      headerRows: 1,
      cells: [
        ['x', '1', '2', '3'],
        ['f(x)', '\\alpha', '\\beta', '\\gamma'],
      ],
    },
  },
  {
    kind: 'division_scheme',
    note:
      'Turkish long division, which is NOT a fraction. The vertical bar and the rule under the divisor ' +
      'are the whole notation — a horizontal bar between dividend and divisor would make a reader answer ' +
      'a different question.',
    item: {
      kind: 'division_scheme',
      style: 'arithmetic',
      dividendTex: 'A',
      divisorTex: 'B',
      quotientTex: '4',
      remainderTex: '5',
    },
  },
  {
    kind: 'vertical_arithmetic',
    note:
      'Masked-digit puzzle. Right alignment is the content: a column that does not line up is a different ' +
      'sum, and indent shifts by whole digit widths.',
    item: {
      kind: 'vertical_arithmetic',
      rows: [
        { tex: '••••' },
        { tex: '36', op: '×' },
        { tex: '•••••' },
        { tex: '9762', op: '+', indent: 1 },
      ],
      hlineAfter: [1, 3],
      resultTex: '••••••',
    },
  },
  {
    kind: 'number_line',
    note:
      'Open and closed ends are the difference between < and ≤, so they are drawn as hollow and filled ' +
      'rather than left to the interval bar.',
    item: {
      kind: 'number_line',
      min: -1,
      max: 6,
      ticks: [{ at: 0, tex: '0' }, { at: 2, tex: '2' }, { at: 5, tex: '5' }],
      intervals: [{ from: 2, to: 5, closedLeft: true, closedRight: false }],
      points: [{ at: 2, style: 'filled', tex: 'a' }],
    },
  },
]

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const cards = SAMPLES.map((sample, index) => {
  let svg: string
  try {
    svg = renderFigItem(sample.item, { idPrefix: `k${index}`, tex: mathjaxRenderer })
  } catch (error) {
    svg = `<p class="err">render failed: ${esc(String(error))}</p>`
  }
  return `
<section class="card">
  <p class="kind">${esc(sample.kind)}</p>
  <p class="note">${esc(sample.note)}</p>
  <div class="render">${svg}</div>
</section>`
})

const today = new Date().toISOString().slice(0, 10)
const html = `<!doctype html>
<meta charset="utf-8">
<title>Figure kinds rendered by core — ${today}</title>
<style>
  :root { color-scheme: light dark; --line: #8883; }
  body { font: 15px/1.6 system-ui, sans-serif; margin: 0 auto; padding: 24px; max-width: 900px; }
  h1 { font-size: 20px; margin-bottom: 6px; }
  .lede { color: #666; margin: 0 0 26px; max-width: 70ch; }
  .card { border: 1px solid var(--line); border-radius: 10px; padding: 16px 18px; margin-bottom: 20px; }
  .kind { display: inline-block; margin: 0 0 8px; padding: 2px 8px; border-radius: 6px;
          background: #8881; font: 600 12px ui-monospace, monospace; }
  .note { color: #777; font-size: 13px; margin: 0 0 14px; max-width: 70ch; }
  .render { overflow-x: auto; }
  .render svg { max-width: 100%; height: auto; background: #fff; border-radius: 6px; }
  .err { color: #d33436; font-size: 13px; }
  footer { color: #888; font-size: 12px; margin-top: 28px; }
</style>
<h1>Figure kinds rendered by core</h1>
<p class="lede">Every FigSpec kind, emitted as SVG by <code>src/core/figures/render.ts</code> with no DOM,
no React and no browser — the same code path the worker's verification wave uses and the same one the
review screen's figure editor previews. All fixtures below are synthetic; no book content.</p>
${cards.join('\n')}
<footer>Generated ${today} by <code>npm run sample:kinds</code> · <code>npm run eval</code> covers this output in the render suite.</footer>
`

const out = `samples/${today}-figure-kinds.html`
writeFileSync(out, html)
console.log(`${out} — ${SAMPLES.length} kind(s)`)

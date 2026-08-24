// What the verification wave is asked to spot — on fixtures nobody owns.
//
//   npm run sample:corruptions
//
// Free and offline. No model call, no database, no book content, so unlike
// `sample:verify` this one is committed under `samples/` and a reviewer can
// open it from the repo.
//
// It shows each fixture question rendered twice: as extracted, and with one
// deliberate corruption of the kind `scripts/verify-smoke.ts` injects. The
// wave's whole job is to look at a pair like this and say which pairs differ,
// so the page is the honest way to judge whether that is a fair thing to ask —
// a difference a reader cannot find here is one the model is unlikely to find
// either, and that is a fact about the render, not about the model.
import { writeFileSync } from 'node:fs'
import type { GeometryFig } from '@/core/figures/figspec'
import type { ExtractedQuestion } from '@/core/questions/extraction'
import { renderQuestion } from '../worker/render-question.ts'

// Written out here rather than imported from the eval suite. A sample has to be
// legible on its own — a reviewer opening this file should see exactly what is
// being drawn without chasing a const through a test — and pinning the shapes
// here means tightening an eval fixture never silently changes what the page
// claims to show.
const TRIANGLE: GeometryFig = {
  kind: 'geometry',
  width: 320,
  height: 240,
  points: [
    { id: 'A', x: 40, y: 200, label: 'A', dot: true },
    { id: 'B', x: 280, y: 200, label: 'B', dot: true },
    { id: 'C', x: 160, y: 40, label: 'C', dot: true },
  ],
  lines: [
    { from: 'A', to: 'B' },
    { from: 'A', to: 'C', ticks: 2 },
    { from: 'B', to: 'C', ticks: 2 },
  ],
  angles: [{ at: ['A', 'C', 'B'], label: '40°', arcs: 1 }],
}

const BISECTOR: GeometryFig = {
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
}

const CROWDED: GeometryFig = {
  kind: 'geometry',
  width: 260,
  height: 200,
  points: [
    { id: 'A', x: 30, y: 20, label: 'A', dot: true },
    { id: 'B', x: 250, y: 20, label: 'B', dot: true },
    { id: 'C', x: 140, y: 90, label: 'C', dot: true },
    { id: 'E', x: 140, y: 150, label: 'E', dot: true },
    { id: 'F', x: 220, y: 150, label: 'F', dot: true },
    { id: 'D', x: 60, y: 190, label: 'D', dot: true },
  ],
  lines: [
    { from: 'B', to: 'A', kind: 'ray', parallel: 1 },
    { from: 'B', to: 'C' },
    { from: 'C', to: 'D' },
    { from: 'D', to: 'E' },
    { from: 'E', to: 'F', kind: 'ray', parallel: 1 },
    { from: 'C', to: 'E' },
  ],
  angles: [
    { at: ['A', 'B', 'C'], label: '20°' },
    { at: ['B', 'C', 'D'], label: '120°' },
    { at: ['C', 'D', 'E'], label: '10°' },
  ],
}

const LABELS = ['A', 'B', 'C', 'D', 'E'] as const

const options = (values: string[]): ExtractedQuestion['options'] =>
  values.map((tex, i) => ({ label: LABELS[i] ?? 'E', tex }))

const fixtureQuestion = (
  name: string,
  stem: string,
  figure: GeometryFig,
  values: string[],
): { name: string; question: ExtractedQuestion } => ({
  name,
  question: {
    numberSeen: 1,
    stem,
    options: options(values),
    figures: { items: [figure] },
    illegible: false,
    clipped: false,
    foreign: false,
    confidence: 1,
    warnings: [],
  } as unknown as ExtractedQuestion,
})

const FIGURE_FIXTURES = [
  fixtureQuestion(
    'isosceles triangle — equal-length ticks carry the reasoning',
    'Şəkildə [AC] = [BC] və m(ACB) = 40°. m(CAB) neçə dərəcədir?',
    TRIANGLE,
    ['70', '60', '50', '40', '30'],
  ),
  fixtureQuestion(
    'angle bisector — two equal arcs are the whole premise',
    '[OB] şüası AOC bucağının tənbölənidir və m(AOB) = 30°. m(AOC) neçə dərəcədir?',
    BISECTOR,
    ['60', '50', '45', '40', '30'],
  ),
  fixtureQuestion(
    'crowded figure — parallel chevrons on two far-apart rays',
    'Şəkildə BA // EF, m(ABC) = 20°, m(CDE) = 10°. m(BCD) neçə dərəcədir?',
    CROWDED,
    ['150', '140', '130', '120', '110'],
  ),
]

const clone = (q: ExtractedQuestion): ExtractedQuestion =>
  JSON.parse(JSON.stringify(q)) as ExtractedQuestion

const geometryOf = (q: ExtractedQuestion): GeometryFig | undefined =>
  q.figures?.items.find((i) => i.kind === 'geometry') as GeometryFig | undefined

interface Corruption {
  name: string
  what: string
  apply: (q: ExtractedQuestion) => ExtractedQuestion | null
}

const CORRUPTIONS: Corruption[] = [
  {
    name: 'changed digit in stem',
    what: 'One digit in the stem is different. The easiest class — it is text.',
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
    what: 'The third option is gone. Countable, so it should never be missed.',
    apply: (q) => {
      if (q.options.length < 3) return null
      const next = clone(q)
      next.options.splice(2, 1)
      return next
    },
  },
  {
    name: 'figure mark removed',
    what:
      'Every equal-length tick, parallel chevron, right-angle square and arc is stripped. ' +
      'The topology is untouched, so the figure still looks plausible — this is the class ' +
      'the wave is weakest on, and the reason marks are DATA rather than strokes.',
    apply: (q) => {
      const next = clone(q)
      const geo = geometryOf(next)
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
    what: 'One segment is deleted. Structural, but easy to miss in a busy figure.',
    apply: (q) => {
      const next = clone(q)
      const geo = geometryOf(next)
      if (!geo || geo.lines.length < 3) return null
      geo.lines.splice(1, 1)
      return next
    },
  },
]

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const draw = (q: ExtractedQuestion): string => {
  try {
    return renderQuestion(q).svg
  } catch (error) {
    return `<p class="err">render failed: ${esc(String(error))}</p>`
  }
}

const cards: string[] = []
let pairs = 0

for (const fixture of FIGURE_FIXTURES) {
  const clean = draw(fixture.question)
  const variants: string[] = []

  for (const corruption of CORRUPTIONS) {
    const damaged = corruption.apply(fixture.question)
    if (!damaged) continue
    pairs++
    variants.push(`
  <div class="variant">
    <h3>${esc(corruption.name)}</h3>
    <p class="what">${esc(corruption.what)}</p>
    <div class="pair">
      <figure><figcaption>as extracted</figcaption><div class="render">${clean}</div></figure>
      <figure><figcaption>corrupted</figcaption><div class="render">${draw(damaged)}</div></figure>
    </div>
  </div>`)
  }

  if (!variants.length) continue
  cards.push(`
<section class="card">
  <h2>${esc(fixture.name)}</h2>
  ${variants.join('\n')}
</section>`)
}

const html = `<!doctype html>
<meta charset="utf-8">
<title>What the verify wave is asked to spot</title>
<style>
  :root { color-scheme: light dark; --line: #8883; }
  body { font: 15px/1.5 system-ui, sans-serif; margin: 0 auto; padding: 24px; max-width: 1180px; }
  h1 { font-size: 20px; margin-bottom: 6px; }
  .lede { color: #666; margin: 0 0 26px; max-width: 68ch; }
  .card { border: 1px solid var(--line); border-radius: 10px; padding: 16px 18px; margin-bottom: 22px; }
  .card > h2 { font-size: 16px; margin: 0 0 4px; }
  .variant { border-top: 1px solid var(--line); margin-top: 16px; padding-top: 14px; }
  .variant h3 { font-size: 14px; margin: 0 0 4px; }
  .what { font-size: 13px; color: #777; margin: 0 0 10px; max-width: 68ch; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  figure { margin: 0; min-width: 0; }
  figcaption { font-size: 12px; color: #888; margin-bottom: 6px; }
  .render { overflow-x: auto; }
  .render svg { max-width: 100%; height: auto; border: 1px solid var(--line); border-radius: 6px; background: #fff; }
  .err { color: #d33436; font-size: 13px; }
  @media (max-width: 800px) { .pair { grid-template-columns: 1fr; } }
</style>
<h1>What the verification wave is asked to spot</h1>
<p class="lede">Each pair is one fixture question rendered as extracted, beside the same question with a
single deliberate corruption — the same damage <code>scripts/verify-smoke.ts</code> injects when it
scores the wave. In the real wave the left-hand side is a scanned crop rather than our own render,
which makes the comparison harder, not easier.
<br><br>
Judge the pairs yourself before reading the wave's scores. A difference you cannot find here is one the
model is unlikely to find either, and that would be a fact about the renderer rather than about the
model. The figure-mark row is the one to look at hardest: it is where the wave currently misses most,
and where the corrupted figure still looks entirely reasonable on its own.</p>
${cards.join('\n')}
`

const out = `samples/${new Date().toISOString().slice(0, 10)}-verify-corruptions.html`
writeFileSync(out, html)
console.log(`${out} — ${pairs} pair(s) across ${cards.length} fixture(s)`)

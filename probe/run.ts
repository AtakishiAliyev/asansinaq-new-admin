// Runs each case and writes the report. Nothing here talks to the live
// database or the production pipeline — the experiment must be able to fail
// without costing anything but the model calls.

import { mkdir, writeFile } from 'node:fs/promises'
import { runAgent } from './agent.ts'
import { buildReport } from './report.ts'
import type { ToolContext } from './tools.ts'

const CASES = [
  { id: 'net-3d', crop: 'probe/cases/p62_q35.jpg' },
  {
    id: 'iq-wheel',
    crop: 'probe/cases/16_p26_c0_q31.jpg',
    // Today: the figure was regenerated and did not match, and all five
    // picture options came back mismatched.
    known: 'option_figure_mismatch ×5, raster_mismatch',
  },
  {
    id: 'iq-prose-options',
    crop: 'probe/cases/16_p26_c1_q34.jpg',
    // Today: the model narrated its own confusion into an option's tex field
    // and returned two options instead of five.
    known: 'option_count, option_prose, option_figure_mismatch',
  },
  {
    id: 'geometry-graph',
    crop: 'probe/cases/geometry_graph.png',
    // A clean print case with a coloured function graph: the control.
    known: 'control — print quality, coloured curves',
  },
]

/** claude-opus-5: $5 / $25 per million tokens */
const STANDARDS = (process.env.PROBE_STANDARDS ?? 'az,en').split(',') as ('az' | 'en')[]
const MODEL = (process.env.PROBE_MODEL ?? 'claude-opus-5') as
  | 'claude-sonnet-5'
  | 'claude-opus-5'
const ONLY = process.env.PROBE_ONLY

const RATE =
  MODEL === 'claude-opus-5'
    ? { in: 5 / 1_000_000, out: 25 / 1_000_000 }
    : { in: 2 / 1_000_000, out: 10 / 1_000_000 }

// Both arms run every case: the loop is being measured, and so is the claim
// that the rules work better in English. One variable each.

const results = []
for (const standard of STANDARDS) {
  console.log(`\n═══ standart: ${standard.toUpperCase()} ═══`)
  for (const c of CASES.filter((c) => !ONLY || c.id === ONLY)) {
    process.stdout.write(`▶ ${c.id} … `)
    const ctx: ToolContext = {
      cropPath: c.crop,
      outDir: `probe/out/${standard}/${c.id}`,
      artefacts: [],
    }
    await mkdir(ctx.outDir, { recursive: true })
    const r = await runAgent(ctx, standard, MODEL)
    const usd = r.inputTokens * RATE.in + r.outputTokens * RATE.out
    results.push({ ...c, ...r, standard, usd, artefacts: ctx.artefacts })
    console.log(
      `${r.outcome} · ${r.steps} addım · ${r.redraws} düzəliş · $${usd.toFixed(3)} · ${(r.ms / 1000).toFixed(0)} san`,
    )
    if (r.error) console.log(`   xəta: ${r.error}`)
  }
}

await writeFile('probe/out/results.json', JSON.stringify(results, null, 2))
await buildReport(results)

console.log('\n' + '─'.repeat(78))
console.log('dil  hal              nəticə     addım  düzəliş   xərc    vaxt')
console.log('─'.repeat(78))
for (const r of results) {
  console.log(
    `${r.standard.padEnd(5)}${r.id.padEnd(17)}${r.outcome.padEnd(11)}${String(r.steps).padEnd(7)}${String(r.redraws).padEnd(9)}$${r.usd.toFixed(3).padEnd(7)}${(r.ms / 1000).toFixed(0)} san`,
  )
}
// The one thing English instructions put at risk: Turkish content coming back
// anglicised. Counted rather than eyeballed.
const TURKISH = /[çğışöüÇĞİŞÖÜ]/
console.log('─'.repeat(78))
for (const standard of STANDARDS) {
  const arm = results.filter((r) => r.standard === standard)
  const withText = arm.filter((r) => typeof r.final?.stem === 'string' && r.final.stem.length > 3)
  const turkish = withText.filter((r) => TURKISH.test(String(r.final!.stem))).length
  const solved = arm.filter((r) => r.outcome === 'done').length
  console.log(
    `${standard.toUpperCase()}: ${solved}/${arm.length} həll · türk hərfləri qorunub ${turkish}/${withText.length} · $${arm.reduce((a, r) => a + r.usd, 0).toFixed(2)}`,
  )
}
const total = results.reduce((a, r) => a + r.usd, 0)
console.log('─'.repeat(72))
console.log(`cəmi $${total.toFixed(2)} · hesabat: probe/out/report.html`)

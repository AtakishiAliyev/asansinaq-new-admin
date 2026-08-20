// Runs each case and writes the report. Nothing here talks to the live
// database or the production pipeline — the experiment must be able to fail
// without costing anything but the model calls.

import { mkdir, writeFile } from 'node:fs/promises'
import { runAgent } from './agent.ts'
import { buildReport } from './report.ts'
import type { ToolContext } from './tools.ts'

const CASES = [
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

const RATE = { in: 15 / 1_000_000, out: 75 / 1_000_000 }

const results = []
for (const c of CASES) {
  process.stdout.write(`\n▶ ${c.id} … `)
  const ctx: ToolContext = {
    cropPath: c.crop,
    outDir: `probe/out/${c.id}`,
    artefacts: [],
  }
  await mkdir(ctx.outDir, { recursive: true })
  const r = await runAgent(ctx)
  const usd = r.inputTokens * RATE.in + r.outputTokens * RATE.out
  results.push({ ...c, ...r, usd, artefacts: ctx.artefacts })
  console.log(
    `${r.outcome} · ${r.steps} addım · ${r.redraws} düzəliş · $${usd.toFixed(3)} · ${(r.ms / 1000).toFixed(0)} san`,
  )
  if (r.error) console.log(`   xəta: ${r.error}`)
}

await writeFile('probe/out/results.json', JSON.stringify(results, null, 2))
await buildReport(results)

console.log('\n' + '─'.repeat(72))
console.log('hal              nəticə     addım  düzəliş   xərc    vaxt')
console.log('─'.repeat(72))
for (const r of results) {
  console.log(
    `${r.id.padEnd(17)}${r.outcome.padEnd(11)}${String(r.steps).padEnd(7)}${String(r.redraws).padEnd(9)}$${r.usd.toFixed(3).padEnd(7)}${(r.ms / 1000).toFixed(0)} san`,
  )
}
const total = results.reduce((a, r) => a + r.usd, 0)
console.log('─'.repeat(72))
console.log(`cəmi $${total.toFixed(2)} · hesabat: probe/out/report.html`)

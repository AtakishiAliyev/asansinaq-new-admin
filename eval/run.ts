// Runs every suite and exits non-zero on the first failing project. Free and
// offline: no model call, no network, no PDF — see README.md for what that
// deliberately does and does not cover.
import type { Suite } from './harness.ts'
import { answerKeySuite } from './suites/answer-key.ts'
import { classifySuite } from './suites/classify.ts'
import { compareSuite } from './suites/compare.ts'
import { extractionSuite } from './suites/extraction.ts'
import { figuresSuite } from './suites/figures.ts'
import { lintSuite } from './suites/lint.ts'
import { pageRangeSuite } from './suites/page-range.ts'
import { segmenterSuite } from './suites/segmenter.ts'
import { errorsSuite } from './suites/errors.ts'
import { promptsSuite } from './suites/prompts.ts'
import { rateGateSuite } from './suites/rate-gate.ts'
import { svgSafeSuite } from './suites/svg-safe.ts'

const SUITES: Suite[] = [
  segmenterSuite,
  svgSafeSuite,
  errorsSuite,
  rateGateSuite,
  promptsSuite,
  classifySuite,
  answerKeySuite,
  compareSuite,
  extractionSuite,
  lintSuite,
  figuresSuite,
  pageRangeSuite,
]

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const DIM = '\x1b[2m'
const OFF = '\x1b[0m'

let passed = 0
const failures: { suite: string; name: string; message: string }[] = []

for (const s of SUITES) {
  const before = failures.length
  const lines: string[] = []
  for (const c of s.cases) {
    try {
      c.fn()
      passed++
      lines.push(`  ${GREEN}✓${OFF} ${DIM}${c.name}${OFF}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push({ suite: s.name, name: c.name, message })
      lines.push(`  ${RED}✗ ${c.name}${OFF}\n      ${message}`)
    }
  }
  const bad = failures.length - before
  console.log(`${bad ? RED : GREEN}${s.name}${OFF} ${DIM}(${s.cases.length})${OFF}`)
  console.log(lines.join('\n'))
}

console.log(
  `\n${passed} keçdi, ${failures.length} uğursuz — ${SUITES.length} dəst`,
)
if (failures.length) {
  console.log(`\n${RED}UĞURSUZ:${OFF}`)
  for (const f of failures) console.log(`  ${f.suite} › ${f.name}: ${f.message}`)
  process.exit(1)
}

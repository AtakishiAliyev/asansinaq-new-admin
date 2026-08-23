// Runs every suite and exits non-zero on the first failing project. Free and
// offline: no model call, no network, no PDF — see README.md for what that
// deliberately does and does not cover.
import type { Suite } from './harness.ts'
import { answerKeySuite } from './suites/answer-key.ts'
import { anthropicRequestSuite } from './suites/anthropic-request.ts'
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
  anthropicRequestSuite,
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

// Every case is offline arithmetic, so anything still running after this is
// parked forever, not slow. Without the guard a single never-settling await
// hangs the whole run, and a hang is indistinguishable from a long one — which
// is worse than a failure, because nothing names the case.
const CASE_TIMEOUT_MS = 5_000

async function runCase(fn: () => void | Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      (async () => fn())(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(`${CASE_TIMEOUT_MS} ms içində bitmədi — bitməyən gözləmə var`),
            ),
          CASE_TIMEOUT_MS,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

let passed = 0
const failures: { suite: string; name: string; message: string }[] = []

for (const s of SUITES) {
  const before = failures.length
  const lines: string[] = []
  for (const c of s.cases) {
    try {
      // Awaited, not just called: an async case returns a promise the moment it
      // hits its first await, and an un-awaited one is counted as passed before
      // a single assertion has run. A rejection then surfaces as an unhandled
      // rejection that kills the whole run instead of naming the case.
      await runCase(c.fn)
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

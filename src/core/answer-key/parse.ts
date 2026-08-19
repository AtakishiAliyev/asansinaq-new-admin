import type { SegItem } from '@/core/segment/types'

// Deterministic answer-key parsing from a page's text layer — no model call,
// no cost, no hallucination surface. Key pages are printed as tables, and a
// table is exactly what a text layer preserves well: the letters are exact,
// only their reading ORDER is unreliable, so everything here works from
// geometry (rows by y, columns by x) rather than from the item sequence.
//
// Scanned key pages have no text layer; those go to the vision op instead.

export interface AnswerKeyEntry {
  /** section number from a "N. DENEME" style header, when the page has one */
  testNo?: number
  qNo: number
  answer: 'A' | 'B' | 'C' | 'D' | 'E'
}

export interface AnswerKeyParse {
  entries: AnswerKeyEntry[]
  notes: string[]
}

const ANSWER_LETTERS = new Set(['A', 'B', 'C', 'D', 'E'])

/** "8. DENEME", "TEST 12", "12. DENEME SINAVI CEVAP ANAHTARI" */
const SECTION_PATTERNS = [
  /(\d{1,3})\s*\.\s*(?:deneme|dənəmə)/i,
  /test\s*[-–]?\s*(\d{1,3})/i,
]

/** A cell that already pairs number and letter: "12. C", "12-C", "12) C". */
const PAIR_RE = /(\d{1,3})\s*[.)\-–:]?\s*([A-E])(?![A-Za-z])/g

// Baselines inside one printed table row drift by a few points (different
// cell fonts and sizes), while rows themselves sit 15pt+ apart. Measuring
// against the row's running mean — not its first item — keeps a drifting row
// together without swallowing the next one.
const ROW_TOLERANCE_PT = 8

// A key table is dense. Question pages also contain "7 B" shaped fragments
// (an option letter beside a question number), so a handful of matches means
// the page is NOT a key page — reading it as one would write confident wrong
// answers onto real questions.
const MIN_KEY_ENTRIES = 8

function isAnswerLetter(s: string): boolean {
  return ANSWER_LETTERS.has(s.trim().toUpperCase())
}

function bareNumber(s: string): number | null {
  const m = s.trim().match(/^(\d{1,3})\s*[.)\-–:]?$/)
  return m ? Number(m[1]) : null
}

/** Group items into visual rows by their vertical position. */
function toRows(items: SegItem[]): SegItem[][] {
  const sorted = items
    .filter((it) => it.str.trim() && Math.abs(it.angle) < 0.09)
    .sort((a, b) => a.yTop - b.yTop)
  const rows: SegItem[][] = []
  const means: number[] = []
  for (const it of sorted) {
    const lastIndex = rows.length - 1
    // rows and means are pushed together, so lastIndex addresses both.
    if (lastIndex >= 0 && Math.abs(means[lastIndex]! - it.yTop) <= ROW_TOLERANCE_PT) {
      const row = rows[lastIndex]!
      means[lastIndex] = (means[lastIndex]! * row.length + it.yTop) / (row.length + 1)
      row.push(it)
    } else {
      rows.push([it])
      means.push(it.yTop)
    }
  }
  return rows.map((r) => r.sort((a, b) => a.x - b.x))
}

interface SectionHeader {
  testNo: number
  x: number
  yTop: number
}

/**
 * Every "N. DENEME" / "TEST N" label on the page, with where it is printed.
 * Matched across the joined row rather than per item (a label is usually split
 * into "8." and "DENEME"), then mapped back to the item it starts in — a grid
 * of tests prints its headers side by side on ONE line, so a row can carry
 * several, and each needs its own x to own the column beneath it.
 */
function findSectionHeaders(rows: SegItem[][]): SectionHeader[] {
  const headers: SectionHeader[] = []
  for (const row of rows) {
    const spans: { start: number; end: number; item: SegItem }[] = []
    let text = ''
    for (const it of row) {
      spans.push({ start: text.length, end: text.length + it.str.length, item: it })
      text += it.str + ' '
    }
    const found = new Map<number, SectionHeader>()
    for (const re of SECTION_PATTERNS) {
      for (const m of text.matchAll(new RegExp(re.source, 'gi'))) {
        if (m.index === undefined) continue
        const span =
          spans.find((s) => m.index! >= s.start && m.index! < s.end) ?? spans[0]
        if (!span) continue
        // Two patterns can match the same label ("TEST 3. DENEME"); the
        // position is what makes them the same header, not the wording.
        if (!found.has(span.item.x)) {
          found.set(span.item.x, {
            testNo: Number(m[1]),
            x: span.item.x,
            yTop: span.item.yTop,
          })
        }
      }
    }
    headers.push(...found.values())
  }
  return headers
}

/** Two headers printed side by side sit within a line of each other. */
const HEADER_BAND_PT = 20

/**
 * Which test an entry belongs to. Books print several tests on one key page —
 * stacked, or side by side in a grid — and reading a single page-level number
 * collapsed all of them into test 1, which then turned every repeated question
 * number into a conflict.
 */
function sectionFor(
  headers: SectionHeader[],
  x: number,
  yTop: number,
): number | undefined {
  if (!headers.length) return undefined
  // One header means one test, including for anything printed above it.
  if (headers.length === 1) return headers[0]!.testNo
  const above = headers.filter((h) => h.yTop <= yTop)
  if (!above.length) return undefined
  // Nearest band above, then nearest across — which resolves a stacked layout
  // by row and a side-by-side grid by column.
  const lowest = Math.max(...above.map((h) => h.yTop))
  const band = above.filter((h) => lowest - h.yTop <= HEADER_BAND_PT)
  return band.reduce((best, h) =>
    Math.abs(h.x - x) < Math.abs(best.x - x) ? h : best,
  ).testNo
}

export function parseAnswerKeyPage(items: SegItem[]): AnswerKeyParse {
  const notes: string[] = []
  const rows = toRows(items)
  const headers = findSectionHeaders(rows)
  // Keyed by TEST and question: a page holding four tests prints question 1
  // four times, and keying on the number alone would read each of those as the
  // same question disagreeing with itself.
  const seen = new Map<string, AnswerKeyEntry>()
  const conflicts = new Set<string>()
  const slot = (testNo: number | undefined, qNo: number) => `${testNo ?? 0}:${qNo}`

  const record = (qNo: number, letter: string, x: number, yTop: number) => {
    if (qNo < 1 || qNo > 999) return
    const answer = letter.trim().toUpperCase() as AnswerKeyEntry['answer']
    if (!ANSWER_LETTERS.has(answer)) return
    const testNo = sectionFor(headers, x, yTop)
    const key = slot(testNo, qNo)
    // A question the page reads two ways is a question this page cannot
    // answer. Keeping the first reading would write a confidently wrong
    // answer, which the pipeline treats as worse than no answer at all.
    if (conflicts.has(key)) return
    const existing = seen.get(key)
    if (existing && existing.answer !== answer) {
      conflicts.add(key)
      seen.delete(key)
      return
    }
    seen.set(key, { qNo, answer, ...(testNo !== undefined ? { testNo } : {}) })
  }

  rows.forEach((row, rowIndex) => {
    const rowText = row.map((it) => it.str).join(' ')
    // "3. DENEME SINAVI" reads as "3 → D" to any pair matcher. Section
    // headers are labels, never data.
    if (SECTION_PATTERNS.some((re) => re.test(rowText))) return

    // Pass 1: cells that already carry both parts ("12. C", "1-A 2-E 3-B").
    for (const it of row) {
      for (const m of it.str.matchAll(PAIR_RE)) {
        // Both PAIR_RE groups are mandatory, so a match carries both.
        record(Number(m[1]), m[2]!, it.x, it.yTop)
      }
    }
    // Pass 2: the number and the letter are separate cells of a table row.
    // Pair each bare number with the next letter to its right, which is how
    // every column-per-answer layout reads.
    let pending: { n: number; x: number } | null = null
    for (const it of row) {
      const n = bareNumber(it.str)
      if (n !== null) {
        pending = { n, x: it.x }
        continue
      }
      if (pending !== null && isAnswerLetter(it.str)) {
        record(pending.n, it.str, pending.x, it.yTop)
        pending = null
      }
    }

    // Pass 3: the numbers are a row and the answers are the row BENEATH it.
    // Neither pass above pairs anything in that layout — the number row holds
    // no letters — so the whole page used to come back empty and be reported
    // as "not a key page".
    const next = rows[rowIndex + 1]
    if (!next || next.length !== row.length || row.length < 3) return
    const numbers = row.map((it) => bareNumber(it.str))
    if (numbers.some((n) => n === null)) return
    if (!next.every((it) => isAnswerLetter(it.str))) return
    numbers.forEach((n, i) => record(n as number, next[i]!.str, row[i]!.x, row[i]!.yTop))
  })

  const entries = [...seen.values()].sort(
    (a, b) => (a.testNo ?? 0) - (b.testNo ?? 0) || a.qNo - b.qNo,
  )

  if (entries.length && entries.length < MIN_KEY_ENTRIES) {
    return {
      entries: [],
      notes: [
        `Cavab açarı cədvəli tapılmadı (yalnız ${entries.length} uyğunluq — sual səhifəsi ola bilər)`,
      ],
    }
  }

  if (conflicts.size) {
    const shown = [...conflicts].slice(0, 5).map((k) => k.split(':')[1])
    notes.push(
      `${conflicts.size} sual üçün ziddiyyətli cavab oxundu (${shown.join(', ')}) — ötürüldü`,
    )
  }
  if (!entries.length) notes.push('Bu səhifədə cavab açarı tapılmadı')
  if (headers.length > 1) {
    notes.push(`Səhifədə ${headers.length} test başlığı tapıldı`)
  }
  // A key table is a dense run of numbers, per test; a gap usually means a
  // missed cell. Counted from 1, not from the first entry: a key whose opening
  // rows were missed would otherwise look complete.
  const byTest = new Map<number, Set<number>>()
  for (const e of entries) {
    const set = byTest.get(e.testNo ?? 0) ?? new Set<number>()
    set.add(e.qNo)
    byTest.set(e.testNo ?? 0, set)
  }
  for (const [testNo, numbers] of byTest) {
    if (numbers.size <= 2) continue
    const last = Math.max(...numbers)
    const missing: number[] = []
    for (let n = 1; n < last; n++) if (!numbers.has(n)) missing.push(n)
    if (missing.length) {
      const where = testNo ? `Test ${testNo}: ` : ''
      notes.push(
        `${where}sıradakı boşluqlar: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? '…' : ''}`,
      )
    }
  }
  return { entries, notes }
}

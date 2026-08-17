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

/**
 * Section number printed on the page itself. Key pages carry it even in books
 * whose question pages do not — that is what makes end-of-book keys matchable.
 */
export function findSectionNumber(items: SegItem[]): number | undefined {
  const joined = items
    .slice()
    .sort((a, b) => a.yTop - b.yTop || a.x - b.x)
    .map((it) => it.str)
    .join(' ')
  for (const re of SECTION_PATTERNS) {
    const m = joined.match(re)
    if (m) return Number(m[1])
  }
  return undefined
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
    if (lastIndex >= 0 && Math.abs(means[lastIndex] - it.yTop) <= ROW_TOLERANCE_PT) {
      const row = rows[lastIndex]
      means[lastIndex] = (means[lastIndex] * row.length + it.yTop) / (row.length + 1)
      row.push(it)
    } else {
      rows.push([it])
      means.push(it.yTop)
    }
  }
  return rows.map((r) => r.sort((a, b) => a.x - b.x))
}

export function parseAnswerKeyPage(items: SegItem[]): AnswerKeyParse {
  const notes: string[] = []
  const testNo = findSectionNumber(items)
  const seen = new Map<number, AnswerKeyEntry>()
  const conflicts: number[] = []

  const record = (qNo: number, letter: string) => {
    if (qNo < 1 || qNo > 999) return
    const answer = letter.trim().toUpperCase() as AnswerKeyEntry['answer']
    if (!ANSWER_LETTERS.has(answer)) return
    const existing = seen.get(qNo)
    if (existing && existing.answer !== answer) {
      conflicts.push(qNo)
      return
    }
    seen.set(qNo, { qNo, answer, ...(testNo !== undefined ? { testNo } : {}) })
  }

  for (const row of toRows(items)) {
    const rowText = row.map((it) => it.str).join(' ')
    // "3. DENEME SINAVI" reads as "3 → D" to any pair matcher. Section
    // headers are labels, never data.
    if (SECTION_PATTERNS.some((re) => re.test(rowText))) continue

    // Pass 1: cells that already carry both parts ("12. C", "1-A 2-E 3-B").
    for (const it of row) {
      for (const m of it.str.matchAll(PAIR_RE)) record(Number(m[1]), m[2])
    }
    // Pass 2: the number and the letter are separate cells of a table row.
    // Pair each bare number with the next letter to its right, which is how
    // every column-per-answer layout reads.
    let pendingNo: number | null = null
    for (const it of row) {
      const n = bareNumber(it.str)
      if (n !== null) {
        pendingNo = n
        continue
      }
      if (pendingNo !== null && isAnswerLetter(it.str)) {
        record(pendingNo, it.str)
        pendingNo = null
      }
    }
  }

  const entries = [...seen.values()].sort((a, b) => a.qNo - b.qNo)

  if (entries.length && entries.length < MIN_KEY_ENTRIES) {
    return {
      entries: [],
      notes: [
        `Cavab açarı cədvəli tapılmadı (yalnız ${entries.length} uyğunluq — sual səhifəsi ola bilər)`,
      ],
    }
  }

  if (conflicts.length) {
    notes.push(
      `${conflicts.length} sual üçün ziddiyyətli cavab oxundu (${conflicts.slice(0, 5).join(', ')}) — ötürüldü`,
    )
  }
  if (!entries.length) notes.push('Bu səhifədə cavab açarı tapılmadı')
  // A key table is a dense run of numbers; a gap usually means a missed cell.
  if (entries.length > 2) {
    const missing: number[] = []
    // Start from 1, not from the first entry: a key whose opening rows were
    // missed would otherwise look complete.
    for (let n = 1; n < entries[entries.length - 1].qNo; n++) {
      if (!seen.has(n)) missing.push(n)
    }
    if (missing.length) {
      notes.push(
        `Sıradakı boşluqlar: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? '…' : ''}`,
      )
    }
  }
  return { entries, notes }
}

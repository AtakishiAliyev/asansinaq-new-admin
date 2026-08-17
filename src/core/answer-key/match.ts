import type { AnswerKeyEntry } from '@/core/answer-key/parse'

// Attaching a printed key to saved questions.
//
// The hard part is not reading "7 → C", it is knowing WHICH question number 7
// is: every section restarts at 1. Two worlds exist in real books:
//
//   * the question pages carry "Test N" — the segmenter stored it, so the
//     match is direct;
//   * the question pages carry nothing, but the KEY page says "8. DENEME" —
//     then the only way to place it is to read the book's own numbering: a
//     section begins wherever the printed number stops increasing, and the
//     Nth section is test N.
//
// Both paths end in explicit (question id → answer) pairs the operator can
// see before anything is written.

export interface MatchableQuestion {
  id: number
  pageNumber: number
  col: number
  qNo: number
  testNo: number | null
}

export interface KeyBlock {
  /** section the key page announced, if any */
  testNo?: number
  sourcePage: number
  entries: AnswerKeyEntry[]
}

export interface BlockMatch {
  block: KeyBlock
  /** section index the block was matched to (1-based), when inferred */
  inferredSection?: number
  pairs: { id: number; answer: string; qNo: number }[]
  /** key entries with no question in the bank yet */
  unmatched: number[]
}

export interface MatchResult {
  blocks: BlockMatch[]
  /** sections found by reading the questions' own numbering */
  sections: { index: number; testNo: number | null; from: number; to: number; count: number }[]
}

function inReadingOrder(questions: MatchableQuestion[]): MatchableQuestion[] {
  return [...questions].sort(
    (a, b) => a.pageNumber - b.pageNumber || a.col - b.col || a.qNo - b.qNo,
  )
}

/**
 * Split the book's questions into sections. A section ends where the printed
 * number stops climbing — that restart is the only in-band signal a book
 * without test banners gives us.
 */
export function inferSections(questions: MatchableQuestion[]) {
  const ordered = inReadingOrder(questions)
  const sections: {
    index: number
    testNo: number | null
    from: number
    to: number
    count: number
    ids: MatchableQuestion[]
  }[] = []
  let current: (typeof sections)[number] | null = null
  let previousNo = Number.POSITIVE_INFINITY

  for (const q of ordered) {
    const restarts = q.qNo <= previousNo
    if (!current || restarts) {
      current = {
        index: sections.length + 1,
        testNo: q.testNo,
        from: q.pageNumber,
        to: q.pageNumber,
        count: 0,
        ids: [],
      }
      sections.push(current)
    }
    current.to = q.pageNumber
    current.count++
    current.ids.push(q)
    if (current.testNo === null && q.testNo !== null) current.testNo = q.testNo
    previousNo = q.qNo
  }
  return sections
}

export function matchAnswerKeys(
  blocks: KeyBlock[],
  questions: MatchableQuestion[],
): MatchResult {
  const sections = inferSections(questions)

  const matched = blocks.map((block): BlockMatch => {
    // 1. The questions themselves know their test number — trust that first.
    let pool = block.testNo
      ? questions.filter((q) => q.testNo === block.testNo)
      : []
    let inferredSection: number | undefined

    // 2. Otherwise place the block by section order: "8. DENEME" is the 8th
    //    run of numbering in the book.
    if (!pool.length && block.testNo) {
      const byTestNo = sections.find((s) => s.testNo === block.testNo)
      const byOrder = sections[block.testNo - 1]
      const section = byTestNo ?? byOrder
      if (section) {
        pool = section.ids
        inferredSection = section.index
      }
    }

    // 3. A book with a single run of numbering needs no section at all.
    if (!pool.length && !block.testNo && sections.length === 1) {
      pool = sections[0].ids
      inferredSection = 1
    }

    const byNumber = new Map(pool.map((q) => [q.qNo, q]))
    const pairs: BlockMatch['pairs'] = []
    const unmatched: number[] = []
    for (const entry of block.entries) {
      const question = byNumber.get(entry.qNo)
      if (question) pairs.push({ id: question.id, answer: entry.answer, qNo: entry.qNo })
      else unmatched.push(entry.qNo)
    }
    return { block, inferredSection, pairs, unmatched }
  })

  return {
    blocks: matched,
    sections: sections.map(({ index, testNo, from, to, count }) => ({
      index,
      testNo,
      from,
      to,
      count,
    })),
  }
}

/** Re-match one block against an operator-chosen section. */
export function matchBlockToSection(
  block: KeyBlock,
  sectionQuestions: MatchableQuestion[],
): BlockMatch {
  const byNumber = new Map(sectionQuestions.map((q) => [q.qNo, q]))
  const pairs: BlockMatch['pairs'] = []
  const unmatched: number[] = []
  for (const entry of block.entries) {
    const question = byNumber.get(entry.qNo)
    if (question) pairs.push({ id: question.id, answer: entry.answer, qNo: entry.qNo })
    else unmatched.push(entry.qNo)
  }
  return { block, pairs, unmatched }
}

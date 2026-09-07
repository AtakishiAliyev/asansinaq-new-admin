// Matching a key to questions by the PAGES the operator paired it with.
//
// `match.ts` infers which section a key belongs to, from a printed test number
// or from where the book's own numbering restarts. A survey of nine real books
// says that inference cannot be made to work: one book prints `Test-1` twice on
// one key page for two different subjects, another heads its sections
// `Deneme 1` in a form no pattern reads, and five of the nine are scans with no
// text layer to read a header from at all.
//
// So the operator states the pairing instead — the import screen already asks
// for both page ranges — and this places the answers with no inference left in
// it. A question is identified by the page it was cropped from and the number
// printed on it, which are two facts nothing has to guess.
//
// Pure: the rule is the whole feature, and it is asserted offline.
import type { AnswerKeyEntry } from '@/core/answer-key/parse'
import type { MatchableQuestion } from '@/core/answer-key/match'

export interface BatchPairing {
  /** The crop pages the operator said this key answers. */
  questionPages: number[]
  entries: AnswerKeyEntry[]
  /**
   * Which printed section on the key pages to take, when they hold several.
   *
   * A key page routinely prints a grid of tests, and every one of them numbers
   * its questions from 1 — so a page of eleven tests answers "question 1"
   * eleven different ways. The pairing says which QUESTIONS the key belongs
   * to; it cannot say which of eleven printed blocks on one page is the right
   * one, and nothing in the geometry can. So the operator picks, from a list
   * of what the page actually printed. Still no inference: a fact stated
   * rather than guessed.
   *
   * Undefined takes every entry, which is right for a key page holding one
   * section — the common case, and the only case where taking everything is
   * unambiguous.
   *
   * A block id rather than a printed test number, because a book reuses those:
   * one key page prints `Test-1` twice, for two subjects.
   */
  section?: string
}

/** A block the key pages printed, as the operator will see it listed. */
export interface KeySection {
  id: string
  /** What the page called it, when it said anything. */
  testNo?: number
  label: string
  count: number
}

export interface BatchMatch {
  /** What will be written: one answer per question that exists. */
  pairs: { id: number; answer: string; qNo: number }[]
  /** Numbers the key answers for which no question has been cropped yet. They
   *  are not lost: the batch is archived and applied when they are. */
  unmatched: number[]
  /** Questions on those pages the key says nothing about. */
  unanswered: number[]
  /**
   * Question numbers printed more than once across the paired pages.
   *
   * The one way this pairing can be wrong: a range that spans a section
   * boundary holds two question 1s, and the key answers only one of them.
   * Refused rather than guessed — picking either would write a confident wrong
   * answer, which the pipeline treats as worse than none — and reported so the
   * operator can split the range.
   */
  ambiguous: number[]
  /** How many questions sit on the paired pages at all. */
  questionCount: number
  /**
   * Question numbers the KEY answers more than one way.
   *
   * Distinct from `ambiguous`, which is about the questions: this is about the
   * key pages holding several sections at once. Dropped rather than resolved
   * by order, because "the first one wins" is a coin flip with a confident
   * answer on the other side of it.
   */
  conflicting: number[]
  /** The blocks the key pages printed, for the operator to choose from. */
  sections: KeySection[]
}

/**
 * Place a key's answers on the questions cropped from the paired pages.
 *
 * `questions` is the book's whole bank; the pages do the filtering, so a caller
 * never has to pre-slice it and cannot pre-slice it wrongly.
 */
export function matchBatch(
  pairing: BatchPairing,
  questions: MatchableQuestion[],
): BatchMatch {
  const pages = new Set(pairing.questionPages)
  const onPages = questions.filter((q) => pages.has(q.pageNumber))

  const grouped = new Map<string, KeySection>()
  for (const entry of pairing.entries) {
    if (entry.sectionId === undefined) continue
    const existing = grouped.get(entry.sectionId)
    if (existing) existing.count++
    else {
      grouped.set(entry.sectionId, {
        id: entry.sectionId,
        ...(entry.testNo !== undefined ? { testNo: entry.testNo } : {}),
        label: entry.testNo !== undefined ? `Test ${entry.testNo}` : `Bölmə ${entry.sectionId}`,
        count: 1,
      })
    }
  }
  // Two blocks a book called the same thing are told apart by their order on
  // the page, or the operator would be picking between two identical rows.
  const byLabel = new Map<string, number>()
  for (const section of grouped.values()) {
    byLabel.set(section.label, (byLabel.get(section.label) ?? 0) + 1)
  }
  const seenLabel = new Map<string, number>()
  const sections = [...grouped.values()].map((section) => {
    if ((byLabel.get(section.label) ?? 0) < 2) return section
    const nth = (seenLabel.get(section.label) ?? 0) + 1
    seenLabel.set(section.label, nth)
    return { ...section, label: `${section.label} (${nth}.)` }
  })

  // The operator's choice narrows the key before anything else looks at it.
  const chosen =
    pairing.section === undefined
      ? pairing.entries
      : pairing.entries.filter((e) => e.sectionId === pairing.section)

  // A number the key answers two ways cannot be written either way.
  const answersFor = new Map<number, Set<string>>()
  for (const entry of chosen) {
    answersFor.set(entry.qNo, (answersFor.get(entry.qNo) ?? new Set()).add(entry.answer))
  }
  const conflicting = [...answersFor.entries()]
    .filter(([, answers]) => answers.size > 1)
    .map(([qNo]) => qNo)
    .sort((a, b) => a - b)
  const conflicted = new Set(conflicting)

  // A number printed twice on the paired pages cannot be resolved by number.
  const byNumber = new Map<number, MatchableQuestion>()
  const repeated = new Set<number>()
  for (const q of onPages) {
    if (byNumber.has(q.qNo)) repeated.add(q.qNo)
    else byNumber.set(q.qNo, q)
  }

  const pairs: BatchMatch['pairs'] = []
  const unmatched: number[] = []
  const answered = new Set<number>()
  const seenNumber = new Set<number>()
  for (const entry of chosen) {
    if (repeated.has(entry.qNo) || conflicted.has(entry.qNo)) continue
    // The same answer printed twice is not two answers; write it once.
    if (seenNumber.has(entry.qNo)) continue
    seenNumber.add(entry.qNo)
    const question = byNumber.get(entry.qNo)
    if (!question) {
      unmatched.push(entry.qNo)
      continue
    }
    pairs.push({ id: question.id, answer: entry.answer, qNo: entry.qNo })
    answered.add(entry.qNo)
  }

  const unanswered = [...byNumber.keys()]
    .filter((n) => !answered.has(n) && !repeated.has(n))
    .sort((a, b) => a - b)

  return {
    pairs,
    unmatched: unmatched.sort((a, b) => a - b),
    unanswered,
    ambiguous: [...repeated].sort((a, b) => a - b),
    conflicting,
    sections,
    questionCount: onPages.length,
  }
}

/**
 * The answers of every batch that covers a page, as `page:qNo -> answer`.
 *
 * Built once per book and read per question, so the worker resolves an answer
 * with a map lookup rather than a query. A later batch wins over an earlier one
 * for the same page and number: re-reading a key is how an operator corrects
 * it, and the correction has to be the one that survives.
 */
export function batchAnswerIndex(
  batches: { questionPages: number[]; entries: { qNo: number; answer: string }[] }[],
): Map<string, string> {
  const index = new Map<string, string>()
  for (const batch of batches) {
    for (const page of batch.questionPages) {
      for (const entry of batch.entries) {
        index.set(`${page}:${entry.qNo}`, entry.answer)
      }
    }
  }
  return index
}

/** The key a `batchAnswerIndex` is read with. */
export const batchAnswerKey = (pageNumber: number, qNo: number): string =>
  `${pageNumber}:${qNo}`

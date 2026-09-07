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
  for (const entry of pairing.entries) {
    if (repeated.has(entry.qNo)) continue
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

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

export interface SectionSuggestion {
  section: KeySection
  /** Why, in the operator's language. Shown instead of a question. */
  reason: string
}

/**
 * Which block of a key page answers these questions — worked out rather than
 * asked.
 *
 * Picking one of eleven identically-shaped blocks is the worst thing this flow
 * ever asked of a person: it is tedious, and a wrong pick writes a confident
 * wrong answer onto every question in the range, which is the failure the
 * whole pipeline is built to avoid. It is also unnecessary most of the time,
 * because the QUESTION pages say which test they belong to — these books print
 * "Test 1" in the page header and the segmenter already reads it.
 *
 * Two pieces of evidence, strongest first:
 *
 *   1. The test number the question pages print. Decisive when exactly one
 *      block carries it: two independent parts of the same book agreeing.
 *   2. Coverage. A block that does not answer every number the pages print
 *      cannot be the right one, and if that leaves exactly one candidate the
 *      answer is forced.
 *
 * Anything less than exactly one candidate returns null and the operator is
 * asked — which is the honest outcome, not a fallback to guessing.
 */
export function suggestSection(
  sections: KeySection[],
  evidence: {
    /** Test numbers the question pages themselves printed. */
    questionTests: number[]
    /** The question numbers cropped from those pages. */
    questionNumbers: number[]
    /** Which numbers each block answers. */
    answeredBy: Map<string, Set<number>>
  },
): SectionSuggestion | null {
  if (sections.length === 1) {
    return { section: sections[0]!, reason: 'açar səhifəsində yalnız bu bölmə var' }
  }
  if (!sections.length) return null

  const tests = new Set(evidence.questionTests)
  if (tests.size === 1) {
    const named = sections.filter((s) => s.testNo !== undefined && tests.has(s.testNo))
    if (named.length === 1) {
      return {
        section: named[0]!,
        reason: `sual səhifələri "${named[0]!.label}" yazır və açarda həmin bölmə var`,
      }
    }
  }

  if (evidence.questionNumbers.length) {
    const covering = sections.filter((s) => {
      const answered = evidence.answeredBy.get(s.id)
      return answered ? evidence.questionNumbers.every((n) => answered.has(n)) : false
    })
    if (covering.length === 1) {
      return {
        section: covering[0]!,
        reason: 'yalnız bu bölmə həmin sual nömrələrinin hamısına cavab verir',
      }
    }
  }
  return null
}

/** Which numbers each block of a key answers, for `suggestSection`. */
export function answeredBySection(entries: AnswerKeyEntry[]): Map<string, Set<number>> {
  const map = new Map<string, Set<number>>()
  for (const entry of entries) {
    if (entry.sectionId === undefined) continue
    map.set(entry.sectionId, (map.get(entry.sectionId) ?? new Set()).add(entry.qNo))
  }
  return map
}

export interface KeyPlanGroup {
  /** The crop pages this group covers — always one printed section's worth. */
  pages: number[]
  /** The test those pages printed, when they printed one. */
  testNo?: number
  section: KeySection
  reason: string
  /** The block's answers, which is what gets archived for these pages. */
  entries: AnswerKeyEntry[]
  match: BatchMatch
}

/**
 * Split pages that print no test number into sections, by where the book's own
 * numbering restarts.
 *
 * Seven of the nine books in the corpus print no test in the question page
 * header — five are scans — so the header rule that carries Soru Bankası does
 * nothing for them, and a whole selection collapsed into one lump that could
 * only take one block. But a section announces itself another way: the numbers
 * stop climbing. Pages 147-148 run 1-12 and pages 150-152 run 1-15, and the
 * restart is as good a boundary as a printed heading.
 *
 * A page with no numbers at all (a divider, a blank) joins the group in
 * progress rather than starting one: it carries no questions, so it can cost
 * nothing, and treating it as a boundary would split a section in two.
 */
export function splitByNumberingRestart(
  pages: number[],
  pageNumbers: Map<number, number[]>,
): number[][] {
  const groups: number[][] = []
  /** Blank pages seen before any section has started. */
  let waiting: number[] = []
  let highest = Number.POSITIVE_INFINITY

  for (const page of [...pages].sort((a, b) => a - b)) {
    const numbers = [...(pageNumbers.get(page) ?? [])].sort((a, b) => a - b)
    if (!numbers.length) {
      // Carries no questions, so it can neither start a section nor split one.
      // Letting it start one cost a whole block: a blank first page took the
      // anchor and shifted every later group onto the wrong test.
      if (groups.length) groups[groups.length - 1]!.push(page)
      else waiting.push(page)
      continue
    }
    if (numbers[0]! <= highest) {
      groups.push([...waiting, page])
      waiting = []
    } else {
      groups[groups.length - 1]!.push(page)
    }
    highest = numbers[numbers.length - 1]!
  }
  // Nothing but blank pages: one group, so the caller still sees them.
  if (waiting.length) groups.push(waiting)
  return groups
}

export interface KeyPlan {
  groups: KeyPlanGroup[]
  /** Pages no block could be found for. Nothing is written for them. */
  unresolved: number[]
  /** Every block the key pages printed, for an operator override. */
  sections: KeySection[]
}

/**
 * Split a page selection into one group per printed section, and give each its
 * own block of the key.
 *
 * A selection is not one section. An operator picks ten pages at a time and a
 * book puts two or three tests in that span — Soru Bankası 2025 A numbers
 * pages 147-148 as Test 1 and pages 150-152 as Test 2 — so asking which single
 * block answers the range has no correct answer: whichever is picked, the
 * other test's questions get nothing. That was the shape of the first version
 * of this and it was wrong.
 *
 * The book already says which test each PAGE belongs to, in its header, and
 * the segmenter reads it. So the unit is the page: pages that agree on a test
 * form a group, the group takes the block carrying that number, and a
 * selection spanning three tests simply produces three groups. Nothing is
 * asked and nothing is left behind.
 *
 * Pages that print no test number end up in `unresolved` unless the key has
 * exactly one block, in which case there is nothing to be wrong about. An
 * operator override is offered for the rest rather than a guess.
 */
export function planKeyBatches(input: {
  questionPages: number[]
  /** What each page printed in its header, where it printed anything. */
  pageTests: Map<number, number>
  /** The question numbers on each page, which is how a section announces
   *  itself in a book that prints no heading. */
  pageNumbers?: Map<number, number[]>
  entries: AnswerKeyEntry[]
  questions: MatchableQuestion[]
  /**
   * The block the operator chose for the FIRST group nothing else resolved.
   *
   * One choice, not one per group: the blocks on a key page are in printed
   * order and so are the sections of the book, so naming where to start names
   * the rest. The operator sees the whole plan before confirming it.
   */
  fallbackSection?: string
}): KeyPlan {
  const probe = matchBatch({ questionPages: input.questionPages, entries: input.entries }, [])
  const sections = probe.sections
  const entriesOf = (id: string) => input.entries.filter((e) => e.sectionId === id)

  // Pages that name the same test belong together; the rest are their own
  // problem and are dealt with below.
  const grouped = new Map<number, number[]>()
  const nameless: number[] = []
  for (const page of input.questionPages) {
    const testNo = input.pageTests.get(page)
    if (testNo === undefined) nameless.push(page)
    else grouped.set(testNo, [...(grouped.get(testNo) ?? []), page])
  }

  const groups: KeyPlanGroup[] = []
  const unresolved: number[] = []

  for (const [testNo, pages] of [...grouped].sort((a, b) => a[0] - b[0])) {
    const named = sections.filter((s) => s.testNo === testNo)
    if (named.length !== 1) {
      unresolved.push(...pages)
      continue
    }
    const section = named[0]!
    const entries = entriesOf(section.id)
    groups.push({
      pages,
      testNo,
      section,
      reason: `səhifələr "${section.label}" yazır`,
      entries,
      match: matchBatch({ questionPages: pages, entries }, input.questions),
    })
  }

  // Pages with no header of their own. They are still split into sections —
  // by where the numbering restarts — and each section is placed by whatever
  // evidence there is, in order of how much it proves.
  if (nameless.length) {
    const pageNumbers =
      input.pageNumbers ??
      new Map(
        nameless.map((page) => [
          page,
          input.questions.filter((q) => q.pageNumber === page).map((q) => q.qNo),
        ]),
      )
    const answered = answeredBySection(input.entries)
    const restarts = splitByNumberingRestart(nameless, pageNumbers)
    const anchor = input.fallbackSection
      ? sections.findIndex((s) => s.id === input.fallbackSection)
      : -1

    restarts.forEach((pages, index) => {
      const numbers = pages.flatMap((p) => pageNumbers.get(p) ?? [])
      let section: KeySection | undefined
      let reason = ''

      if (sections.length === 1) {
        section = sections[0]
        reason = 'açar səhifəsində yalnız bu bölmə var'
      } else if (numbers.length) {
        // A block that does not answer every number these pages print cannot
        // be the right one; one survivor forces the answer with no choice.
        const covering = sections.filter((s) => {
          const set = answered.get(s.id)
          return set ? numbers.every((n) => set.has(n)) : false
        })
        if (covering.length === 1) {
          section = covering[0]
          reason = 'yalnız bu bölmə həmin sual nömrələrinin hamısına cavab verir'
        }
      }
      if (!section && anchor >= 0) {
        section = sections[anchor + index]
        reason =
          index === 0
            ? 'bölmə əl ilə seçildi'
            : 'açardakı sıra ilə seçilən bölmədən sonra gəlir'
      }

      if (!section) {
        unresolved.push(...pages)
        return
      }
      const entries = entriesOf(section.id)
      groups.push({
        pages,
        section,
        reason,
        entries,
        match: matchBatch({ questionPages: pages, entries }, input.questions),
      })
    })
  }

  return { groups, unresolved: unresolved.sort((a, b) => a - b), sections }
}

/** The key a `batchAnswerIndex` is read with. */
export const batchAnswerKey = (pageNumber: number, qNo: number): string =>
  `${pageNumber}:${qNo}`

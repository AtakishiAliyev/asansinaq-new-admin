// Placing a key by the pages the operator paired it with.
//
// Every case here is a layout the section-inferring matcher gets wrong on a
// real book, and gets right once the operator has said which pages the key
// answers. The survey that produced them covered nine books: one prints
// `Test-1` twice on a single key page for two different subjects, one heads
// its sections `Deneme 1` in a form no pattern reads, and five have no text
// layer to read a header from at all.
import {
  answeredBySection,
  batchAnswerIndex,
  batchAnswerKey,
  matchBatch,
  planKeyBatches,
  splitByNumberingRestart,
  suggestSection,
  type KeySection,
} from '@/core/answer-key/batch'
import { readVisionKey } from '@/core/answer-key/vision'
import type { MatchableQuestion } from '@/core/answer-key/batch'
import type { AnswerKeyEntry } from '@/core/answer-key/parse'
import { deepEq, eq, notOk, ok, suite } from '../harness.ts'

let nextId = 1
/** Questions as the bank holds them: a page, a printed number, no test. */
const onPage = (pageNumber: number, numbers: number[]): MatchableQuestion[] =>
  numbers.map((qNo) => ({ id: nextId++, pageNumber, col: 0, qNo, testNo: null }))

const key = (pairs: [number, string][]): AnswerKeyEntry[] =>
  pairs.map(([qNo, answer]) => ({ qNo, answer: answer as AnswerKeyEntry['answer'] }))

export const answerKeyBatchSuite = suite('answer-key-batch', {
  'a key lands on the questions cropped from the paired pages'() {
    const questions = [...onPage(5, [1, 2, 3]), ...onPage(6, [4, 5])]
    const match = matchBatch(
      { questionPages: [5, 6], entries: key([[1, 'A'], [2, 'B'], [3, 'C'], [4, 'D'], [5, 'E']]) },
      questions,
    )
    eq(match.pairs.length, 5, 'every question answered')
    eq(match.questionCount, 5)
    deepEq(match.pairs.map((p) => p.answer), ['A', 'B', 'C', 'D', 'E'])
    eq(match.unmatched.length, 0)
    eq(match.unanswered.length, 0)
    eq(match.ambiguous.length, 0)
  },

  // The failure this whole feature exists for: two sections both numbered
  // from 1, in one book. Paired by page, they never meet.
  'two sections that both start at 1 stay apart'() {
    const questions = [...onPage(5, [1, 2]), ...onPage(60, [1, 2])]
    const first = matchBatch({ questionPages: [5], entries: key([[1, 'A'], [2, 'B']]) }, questions)
    const second = matchBatch({ questionPages: [60], entries: key([[1, 'E'], [2, 'D']]) }, questions)
    deepEq(first.pairs.map((p) => p.answer), ['A', 'B'])
    deepEq(second.pairs.map((p) => p.answer), ['E', 'D'])
    ok(first.pairs[0]!.id !== second.pairs[0]!.id, 'they are different questions')
    eq(first.ambiguous.length, 0, 'nothing is ambiguous — the pages separate them')
  },

  // The one way the pairing can be wrong: a range that spans a section
  // boundary holds two question 1s and the key answers only one.
  'a range spanning a numbering restart refuses rather than guesses'() {
    const questions = [...onPage(5, [1, 2]), ...onPage(6, [1, 2])]
    const match = matchBatch(
      { questionPages: [5, 6], entries: key([[1, 'A'], [2, 'B']]) },
      questions,
    )
    eq(match.pairs.length, 0, 'nothing is written on a coin flip')
    deepEq(match.ambiguous, [1, 2], 'and the operator is told which numbers')
  },

  'a repeat leaves the unambiguous numbers alone'() {
    const questions = [...onPage(5, [1, 2]), ...onPage(6, [2, 3])]
    const match = matchBatch(
      { questionPages: [5, 6], entries: key([[1, 'A'], [2, 'B'], [3, 'C']]) },
      questions,
    )
    deepEq(match.ambiguous, [2], 'only 2 is printed twice')
    deepEq(match.pairs.map((p) => p.qNo).sort((a, b) => a - b), [1, 3])
  },

  // A key read before its questions were cropped is not a failure: the batch
  // is kept and applied when they arrive.
  'a key ahead of the crops reports what has no question yet'() {
    const match = matchBatch(
      { questionPages: [5], entries: key([[1, 'A'], [2, 'B'], [3, 'C']]) },
      onPage(5, [1]),
    )
    eq(match.pairs.length, 1)
    deepEq(match.unmatched, [2, 3])
  },

  // The state an operator lands in when they read the key in the same sitting
  // as the crop: the crops are on screen but not yet sent, so the bank holds
  // nothing for those pages. Archiving is exactly what the batch is for, and a
  // run that writes nothing today is still worth keeping.
  'a key read before any crop was sent still has everything to archive'() {
    const match = matchBatch(
      { questionPages: [4, 5, 6], entries: key([[1, 'A'], [2, 'B'], [3, 'C']]) },
      onPage(99, [1, 2, 3]),
    )
    eq(match.questionCount, 0, 'nothing cropped from those pages yet')
    eq(match.pairs.length, 0, 'so nothing can be written now')
    deepEq(match.unmatched, [1, 2, 3], 'and everything is waiting to be')
    eq(match.ambiguous.length, 0, 'which is not an error')
    eq(match.conflicting.length, 0)
  },

  'questions the key says nothing about are named too'() {
    const match = matchBatch(
      { questionPages: [5], entries: key([[1, 'A']]) },
      onPage(5, [1, 2, 3]),
    )
    deepEq(match.unanswered, [2, 3])
  },

  'a page outside the pairing is never touched'() {
    const questions = [...onPage(5, [1]), ...onPage(99, [1])]
    const match = matchBatch({ questionPages: [5], entries: key([[1, 'A']]) }, questions)
    eq(match.pairs.length, 1)
    eq(match.pairs[0]!.id, questions[0]!.id, 'the question on page 5, not page 99')
    eq(match.questionCount, 1, 'page 99 is not even counted')
  },

  // What the worker reads. Built once per book, one lookup per question.
  'the worker index answers by page and number'() {
    const index = batchAnswerIndex([
      { questionPages: [5, 6], entries: [{ qNo: 1, answer: 'A' }] },
      { questionPages: [60], entries: [{ qNo: 1, answer: 'E' }] },
    ])
    eq(index.get(batchAnswerKey(5, 1)), 'A')
    eq(index.get(batchAnswerKey(6, 1)), 'A', 'every page of the pairing resolves')
    eq(index.get(batchAnswerKey(60, 1)), 'E', 'and the other section is its own')
    notOk(index.has(batchAnswerKey(7, 1)), 'a page nobody paired has no answer')
  },

  // Re-reading a key is how an operator corrects one, so the correction has to
  // be the reading that survives.
  'a later batch corrects an earlier one for the same page'() {
    const index = batchAnswerIndex([
      { questionPages: [5], entries: [{ qNo: 1, answer: 'A' }] },
      { questionPages: [5], entries: [{ qNo: 1, answer: 'C' }] },
    ])
    eq(index.get(batchAnswerKey(5, 1)), 'C')
  },

  // A key page prints a grid of tests and every one numbers from 1, so the
  // page answers "question 1" a dozen ways. The pairing says which QUESTIONS
  // the key belongs to; it cannot say which printed block is meant.
  'a key page holding several sections offers them and answers nothing yet'() {
    const entries = [
      { qNo: 1, answer: 'A' as const, testNo: 1, sectionId: '1' },
      { qNo: 1, answer: 'E' as const, testNo: 2, sectionId: '2' },
      { qNo: 2, answer: 'B' as const, testNo: 1, sectionId: '1' },
      { qNo: 2, answer: 'D' as const, testNo: 2, sectionId: '2' },
    ]
    const match = matchBatch({ questionPages: [5], entries }, onPage(5, [1, 2]))
    deepEq(match.sections.map((s) => s.label), ['Test 1', 'Test 2'], 'both blocks are offered')
    deepEq(match.conflicting, [1, 2], 'and neither number is written on a coin flip')
    eq(match.pairs.length, 0)
  },

  'choosing a section takes that block and only that block'() {
    const entries = [
      { qNo: 1, answer: 'A' as const, testNo: 1, sectionId: '1' },
      { qNo: 1, answer: 'E' as const, testNo: 2, sectionId: '2' },
      { qNo: 2, answer: 'B' as const, testNo: 1, sectionId: '1' },
      { qNo: 2, answer: 'D' as const, testNo: 2, sectionId: '2' },
    ]
    const questions = onPage(5, [1, 2])
    const first = matchBatch({ questionPages: [5], entries, section: '1' }, questions)
    deepEq(first.pairs.map((p) => p.answer), ['A', 'B'])
    eq(first.conflicting.length, 0, 'inside one section there is no disagreement')
    const second = matchBatch({ questionPages: [5], entries, section: '2' }, questions)
    deepEq(second.pairs.map((p) => p.answer), ['E', 'D'])
  },

  // A key that repeats itself is not a key that disagrees with itself.
  'the same answer printed twice is written once'() {
    const match = matchBatch(
      { questionPages: [5], entries: key([[1, 'A'], [1, 'A']]) },
      onPage(5, [1]),
    )
    eq(match.pairs.length, 1)
    eq(match.conflicting.length, 0)
  },

  // Five of nine books are pure scans, so the model read is the majority path
  // and was the only one going in unchecked.
  'a scanned read is held to the rules the text path applies to itself'() {
    const read = readVisionKey([
      { q_no: 1, answer: 'A' },
      { q_no: 2, answer: 'F' },
      { q_no: 3, answer: 'c' },
      { q_no: 0, answer: 'B' },
      { q_no: 4, answer: 'B' },
      { q_no: 4, answer: 'D' },
    ])
    deepEq(read.entries.map((e) => `${e.qNo}${e.answer}`), ['1A', '3C'], 'only what is believable')
    ok(read.notes.some((n) => /atıldı/.test(n)), 'the rejects are reported')
    ok(read.notes.some((n) => /ziddiyyət/.test(n)), 'and so is the disagreement')
  },

  'a scanned page keeps its sections apart, as the text path does'() {
    const read = readVisionKey([
      { q_no: 1, answer: 'A', test_no: 1 },
      { q_no: 1, answer: 'E', test_no: 2 },
    ])
    eq(read.entries.length, 2, 'two sections, not one question disagreeing')
    notOk(read.notes.some((n) => /ziddiyyət/.test(n)))
  },

  // Soru Bankası 2025 A prints `Test-1` twice on one key page for two subjects.
  // Keyed by the printed number the two collide and the conflict rule drops
  // both, which on the text path cost 14 of that test's 16 answers before
  // blocks existed there. A scan has no geometry to recover the position from,
  // so the model is asked which block it read from.
  'a scanned page tells two blocks the book named the same thing apart'() {
    const read = readVisionKey([
      { q_no: 1, answer: 'A', test_no: 1, block: 1 },
      { q_no: 2, answer: 'B', test_no: 1, block: 1 },
      { q_no: 1, answer: 'E', test_no: 1, block: 2 },
      { q_no: 2, answer: 'D', test_no: 1, block: 2 },
    ])
    eq(read.entries.length, 4, 'both blocks survive')
    notOk(read.notes.some((n) => /ziddiyyət/.test(n)))
    eq(new Set(read.entries.map((e) => e.sectionId)).size, 2, 'two blocks')
    ok(
      read.entries.every((e) => e.testNo === 1),
      'and both keep the number the book printed',
    )
  },

  // The field is new, so a model that ignores it must leave the read no worse
  // than it was before the field was asked for.
  'a scanned read with no block index falls back to the printed number'() {
    const read = readVisionKey([
      { q_no: 1, answer: 'A', test_no: 1 },
      { q_no: 1, answer: 'E', test_no: 2 },
    ])
    eq(read.entries.length, 2, 'still two sections')
    eq(new Set(read.entries.map((e) => e.sectionId)).size, 2, 'told apart by number')
  },

  'a thin scanned read says so rather than passing quietly'() {
    const read = readVisionKey([{ q_no: 1, answer: 'A' }, { q_no: 2, answer: 'B' }])
    eq(read.entries.length, 2, 'the answers still stand — the operator named this page')
    ok(read.notes.some((n) => /zəif oxunmuş/.test(n)), 'but the thinness is named')
  },

  // Picking one of eleven identical-looking blocks is the worst thing this
  // flow ever asked of a person, and it is usually unnecessary: these books
  // print "Test 1" in the question page header and the segmenter reads it.
  'the block is worked out from what the question pages print'() {
    const sections: KeySection[] = [
      { id: 'a', testNo: 1, label: 'Test 1', count: 16 },
      { id: 'b', testNo: 2, label: 'Test 2', count: 16 },
      { id: 'c', testNo: 3, label: 'Test 3', count: 16 },
    ]
    const answeredBy = new Map([
      ['a', new Set([1, 2, 3])],
      ['b', new Set([1, 2, 3])],
      ['c', new Set([1, 2, 3])],
    ])
    const picked = suggestSection(sections, {
      questionTests: [1],
      questionNumbers: [1, 2, 3],
      answeredBy,
    })
    eq(picked?.section.id, 'a', 'the book agreed with itself')
    ok(/Test 1/.test(picked?.reason ?? ''), picked?.reason ?? 'no reason given')
  },

  // Coverage decides when the pages carry no header: a block that does not
  // answer every number cannot be the right one.
  'a block that cannot cover the questions is ruled out'() {
    const sections: KeySection[] = [
      { id: 'a', label: 'Bölmə 1', count: 2 },
      { id: 'b', label: 'Bölmə 2', count: 5 },
    ]
    const picked = suggestSection(sections, {
      questionTests: [],
      questionNumbers: [1, 2, 3, 4, 5],
      answeredBy: new Map([
        ['a', new Set([1, 2])],
        ['b', new Set([1, 2, 3, 4, 5])],
      ]),
    })
    eq(picked?.section.id, 'b')
  },

  // No evidence is not a licence to guess: a wrong block writes a confident
  // wrong answer onto every question in the range.
  'with nothing to go on the operator is asked'() {
    const sections: KeySection[] = [
      { id: 'a', testNo: 1, label: 'Test 1', count: 3 },
      { id: 'b', testNo: 2, label: 'Test 2', count: 3 },
    ]
    const answeredBy = new Map([
      ['a', new Set([1, 2, 3])],
      ['b', new Set([1, 2, 3])],
    ])
    eq(
      suggestSection(sections, { questionTests: [], questionNumbers: [1, 2, 3], answeredBy }),
      null,
      'both fit, so neither is chosen',
    )
    eq(
      suggestSection(sections, { questionTests: [7], questionNumbers: [1, 2, 3], answeredBy }),
      null,
      'a test number no block carries decides nothing',
    )
  },

  'a single block needs no evidence at all'() {
    const only: KeySection[] = [{ id: 'a', testNo: 9, label: 'Test 9', count: 3 }]
    const picked = suggestSection(only, {
      questionTests: [],
      questionNumbers: [],
      answeredBy: new Map(),
    })
    eq(picked?.section.id, 'a')
  },

  'the numbers each block answers come from the entries themselves'() {
    const map = answeredBySection([
      { qNo: 1, answer: 'A', sectionId: 'a' },
      { qNo: 2, answer: 'B', sectionId: 'a' },
      { qNo: 1, answer: 'E', sectionId: 'b' },
      { qNo: 3, answer: 'C' },
    ])
    deepEq([...(map.get('a') ?? [])], [1, 2])
    deepEq([...(map.get('b') ?? [])], [1])
    notOk(map.has('undefined'), 'an entry with no block is not a block')
  },

  // The failure the plan exists for. An operator picks ten pages; the book
  // puts Test 1 on 147-148 and Test 2 on 150-152. Asking which single block
  // answers the range has no correct answer — whichever is chosen, the other
  // test's questions get nothing.
  'a selection spanning two tests becomes two groups'() {
    const entries = [
      { qNo: 1, answer: 'A' as const, testNo: 1, sectionId: 'a' },
      { qNo: 2, answer: 'B' as const, testNo: 1, sectionId: 'a' },
      { qNo: 1, answer: 'E' as const, testNo: 2, sectionId: 'b' },
      { qNo: 2, answer: 'D' as const, testNo: 2, sectionId: 'b' },
    ]
    const questions = [...onPage(147, [1, 2]), ...onPage(150, [1, 2])]
    const plan = planKeyBatches({
      questionPages: [147, 150],
      pageTests: new Map([[147, 1], [150, 2]]),
      entries,
      questions,
    })
    eq(plan.groups.length, 2, 'one group per printed test')
    eq(plan.unresolved.length, 0, 'and nothing left behind')
    deepEq(plan.groups[0]!.pages, [147])
    deepEq(plan.groups[0]!.match.pairs.map((p) => p.answer), ['A', 'B'])
    deepEq(plan.groups[1]!.pages, [150])
    deepEq(plan.groups[1]!.match.pairs.map((p) => p.answer), ['E', 'D'])
    // The whole selection lands, which one block never could.
    eq(
      plan.groups.reduce((n, g) => n + g.match.pairs.length, 0),
      4,
      'every question in the selection is answered',
    )
  },

  // Two pages of one test are one group, not two.
  'pages that name the same test are grouped together'() {
    const entries = [
      { qNo: 1, answer: 'A' as const, testNo: 1, sectionId: 'a' },
      { qNo: 7, answer: 'C' as const, testNo: 1, sectionId: 'a' },
    ]
    const plan = planKeyBatches({
      questionPages: [147, 148],
      pageTests: new Map([[147, 1], [148, 1]]),
      entries,
      questions: [...onPage(147, [1]), ...onPage(148, [7])],
    })
    eq(plan.groups.length, 1)
    deepEq(plan.groups[0]!.pages, [147, 148])
    eq(plan.groups[0]!.match.pairs.length, 2)
  },

  // A page that prints nothing is not attached to a guess, and it does not
  // stop the pages that DID name their test from being written.
  'a page with no header is left unresolved without blocking the rest'() {
    const entries = [
      { qNo: 1, answer: 'A' as const, testNo: 1, sectionId: 'a' },
      { qNo: 1, answer: 'E' as const, testNo: 2, sectionId: 'b' },
    ]
    const plan = planKeyBatches({
      questionPages: [147, 149],
      pageTests: new Map([[147, 1]]),
      entries,
      questions: [...onPage(147, [1]), ...onPage(149, [1])],
    })
    eq(plan.groups.length, 1, 'the page that named its test is still written')
    deepEq(plan.unresolved, [149])
    deepEq(plan.sections.map((s) => s.label), ['Test 1', 'Test 2'], 'and a choice is offered')
  },

  'an operator override places the pages nothing resolved'() {
    const entries = [
      { qNo: 1, answer: 'A' as const, testNo: 1, sectionId: 'a' },
      { qNo: 1, answer: 'E' as const, testNo: 2, sectionId: 'b' },
    ]
    const plan = planKeyBatches({
      questionPages: [149],
      pageTests: new Map(),
      entries,
      questions: onPage(149, [1]),
      fallbackSection: 'b',
    })
    eq(plan.unresolved.length, 0)
    deepEq(plan.groups[0]!.match.pairs.map((p) => p.answer), ['E'])
  },

  'a key with one block needs no header and no choice'() {
    const entries = key([[1, 'A'], [2, 'B']]).map((e) => ({ ...e, sectionId: 'only' }))
    const plan = planKeyBatches({
      questionPages: [10],
      pageTests: new Map(),
      entries,
      questions: onPage(10, [1, 2]),
    })
    eq(plan.groups.length, 1)
    eq(plan.unresolved.length, 0)
    eq(plan.groups[0]!.match.pairs.length, 2)
  },

  // Seven of the nine books print no test in the question page header — five
  // are scans — so the header rule does nothing for them. A section still
  // announces itself: the numbers stop climbing.
  'headerless pages split where the numbering restarts'() {
    const numbers = new Map([
      [147, [1, 2, 3]],
      [148, [4, 5, 6]],
      [150, [1, 2, 3]],
      [151, [4, 5]],
    ])
    deepEq(splitByNumberingRestart([147, 148, 150, 151], numbers), [[147, 148], [150, 151]])
  },

  // A divider carries no questions, so it can cost nothing — and treating it
  // as a boundary would cut a section in two.
  'a page with no questions does not start a section'() {
    const numbers = new Map([
      [147, [1, 2]],
      [149, []],
      [150, [3, 4]],
    ])
    deepEq(splitByNumberingRestart([147, 149, 150], numbers), [[147, 149, 150]])
  },

  // Measured on MANTIK 2025: page 6 is blank, so it opened a group of its own,
  // took the operator's anchor block, and shifted every real section onto the
  // next test's answers.
  'a blank first page joins the section that follows it'() {
    const numbers = new Map([
      [6, []],
      [7, [1, 2]],
      [8, [3, 4]],
      [17, [1, 2]],
    ])
    deepEq(splitByNumberingRestart([6, 7, 8, 17], numbers), [[6, 7, 8], [17]])
  },

  // MANTIK 2025 page 108 reads `7,8,9,10,11,13` — the 12 came back a 13 — so
  // page 109, which genuinely continues at 13, looked like a restart under a
  // rule that compared against the previous page's HIGHEST number. The section
  // split, the book then had 31 sections against 30 printed blocks, and all
  // 1,186 of its questions were refused because the order could not be proved.
  'a misread digit at a page boundary is not a restart'() {
    const numbers = new Map([
      [107, [1, 2, 3, 4, 5, 6]],
      [108, [7, 8, 9, 10, 11, 13]],
      [109, [13, 14, 15, 16, 17]],
      [117, [1, 2, 3, 4, 5, 6]],
    ])
    deepEq(splitByNumberingRestart([107, 108, 109, 117], numbers), [
      [107, 108, 109],
      [117],
    ])
  },

  'a selection of nothing but blank pages is still one group'() {
    deepEq(splitByNumberingRestart([1, 2], new Map()), [[1, 2]])
  },

  // One choice, not one per group: the blocks are in printed order and so are
  // the book's sections, so naming where to start names the rest.
  'a headerless selection needs one choice and places the rest in order'() {
    const entries = [
      { qNo: 1, answer: 'A' as const, testNo: 1, sectionId: 'a' },
      { qNo: 2, answer: 'B' as const, testNo: 1, sectionId: 'a' },
      { qNo: 1, answer: 'E' as const, testNo: 2, sectionId: 'b' },
      { qNo: 2, answer: 'D' as const, testNo: 2, sectionId: 'b' },
      { qNo: 1, answer: 'C' as const, testNo: 3, sectionId: 'c' },
      { qNo: 2, answer: 'C' as const, testNo: 3, sectionId: 'c' },
    ]
    const pageNumbers = new Map([
      [10, [1, 2]],
      [11, [1, 2]],
    ])
    const questions = [...onPage(10, [1, 2]), ...onPage(11, [1, 2])]
    const asked = planKeyBatches({
      questionPages: [10, 11],
      pageTests: new Map(),
      pageNumbers,
      entries,
      questions,
    })
    deepEq(asked.unresolved, [10, 11], 'nothing is guessed without an anchor')

    const placed = planKeyBatches({
      questionPages: [10, 11],
      pageTests: new Map(),
      pageNumbers,
      entries,
      questions,
      fallbackSection: 'b',
    })
    eq(placed.groups.length, 2, 'two sections, from the numbering restart')
    eq(placed.unresolved.length, 0, 'and both are placed from one choice')
    eq(placed.groups[0]!.section.label, 'Test 2', 'the anchor')
    eq(placed.groups[1]!.section.label, 'Test 3', 'and the next block in order')
    deepEq(placed.groups[0]!.match.pairs.map((p) => p.answer), ['E', 'D'])
    deepEq(placed.groups[1]!.match.pairs.map((p) => p.answer), ['C', 'C'])
  },

  // Coverage can settle it with no choice at all: a block that does not answer
  // every number the pages print cannot be the right one.
  'a headerless group with only one covering block needs no choice'() {
    const entries = [
      { qNo: 1, answer: 'A' as const, testNo: 1, sectionId: 'a' },
      { qNo: 1, answer: 'E' as const, testNo: 2, sectionId: 'b' },
      { qNo: 2, answer: 'D' as const, testNo: 2, sectionId: 'b' },
      { qNo: 3, answer: 'C' as const, testNo: 2, sectionId: 'b' },
    ]
    const plan = planKeyBatches({
      questionPages: [10],
      pageTests: new Map(),
      pageNumbers: new Map([[10, [1, 2, 3]]]),
      entries,
      questions: onPage(10, [1, 2, 3]),
    })
    eq(plan.unresolved.length, 0, 'the short block cannot cover 1-3')
    eq(plan.groups[0]!.section.label, 'Test 2')
    ok(/həmin sual nömrələrinin hamısına/.test(plan.groups[0]!.reason), plan.groups[0]!.reason)
  },
})

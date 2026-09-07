// Placing a key by the pages the operator paired it with.
//
// Every case here is a layout the section-inferring matcher gets wrong on a
// real book, and gets right once the operator has said which pages the key
// answers. The survey that produced them covered nine books: one prints
// `Test-1` twice on a single key page for two different subjects, one heads
// its sections `Deneme 1` in a form no pattern reads, and five have no text
// layer to read a header from at all.
import { batchAnswerIndex, batchAnswerKey, matchBatch } from '@/core/answer-key/batch'
import { readVisionKey } from '@/core/answer-key/vision'
import type { MatchableQuestion } from '@/core/answer-key/match'
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

  'a thin scanned read says so rather than passing quietly'() {
    const read = readVisionKey([{ q_no: 1, answer: 'A' }, { q_no: 2, answer: 'B' }])
    eq(read.entries.length, 2, 'the answers still stand — the operator named this page')
    ok(read.notes.some((n) => /zəif oxunmuş/.test(n)), 'but the thinness is named')
  },
})

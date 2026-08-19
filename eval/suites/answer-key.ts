import { parseAnswerKeyPage } from '@/core/answer-key/parse'
import { deepEq, eq, ok, suite } from '../harness.ts'
import { items } from './fixtures.ts'

/** A key table row: "1 A   2 B   3 C" as separate cells, the common layout. */
function keyRow(y: number, pairs: [number, string][], x0 = 60, step = 90) {
  return pairs.flatMap(([n, a], i) => [
    { str: String(n), x: x0 + i * step, y, w: 12 },
    { str: a, x: x0 + i * step + 20, y, w: 10 },
  ])
}

const parse = (specs: Parameters<typeof items>[0]) =>
  parseAnswerKeyPage(items(specs))

export const answerKeySuite = suite('answer-key', {
  'a table of separate number and letter cells is read'() {
    const page = parse([
      ...keyRow(100, [
        [1, 'A'],
        [2, 'B'],
        [3, 'C'],
      ]),
      ...keyRow(120, [
        [4, 'D'],
        [5, 'E'],
        [6, 'A'],
      ]),
      ...keyRow(140, [
        [7, 'B'],
        [8, 'C'],
        [9, 'D'],
      ]),
    ])
    eq(page.entries.length, 9, 'giriş sayı')
    deepEq(
      page.entries.map((e) => e.answer).join(''),
      'ABCDEABCD',
      'cavab ardıcıllığı',
    )
  },

  'fused cells like "12. C" are read'() {
    const page = parse(
      Array.from({ length: 9 }, (_, i) => ({
        str: `${i + 1}. ${'ABCDE'[i % 5]}`,
        x: 60,
        y: 100 + i * 18,
        w: 30,
      })),
    )
    eq(page.entries.length, 9, 'giriş sayı')
    eq(page.entries[0]!.answer, 'A', 'ilk cavab')
  },

  'a section header is a label, never data'() {
    // "3. DENEME" reads as 3 → D to any pair matcher.
    const page = parse([
      { str: '3. DENEME CEVAP ANAHTARI', x: 200, y: 60, w: 200 },
      ...keyRow(100, [
        [1, 'A'],
        [2, 'B'],
        [3, 'C'],
      ]),
      ...keyRow(120, [
        [4, 'D'],
        [5, 'E'],
        [6, 'A'],
      ]),
      ...keyRow(140, [
        [7, 'B'],
        [8, 'C'],
        [9, 'D'],
      ]),
    ])
    eq(page.entries.length, 9, 'giriş sayı')
    eq(page.entries[2]!.answer, 'C', '3-cü sual başlıqdan D oxumur')
    ok(
      page.entries.every((e) => e.testNo === 3),
      'testNo başlıqdan götürülür',
    )
  },

  'a question page is not mistaken for a key page'() {
    // "7 B" fragments appear on ordinary question pages; a handful of matches
    // must not be written onto real questions as answers.
    const page = parse([
      { str: '7', x: 60, y: 100, w: 12 },
      { str: 'B', x: 80, y: 100, w: 10 },
      { str: '8', x: 60, y: 130, w: 12 },
      { str: 'C', x: 80, y: 130, w: 10 },
    ])
    deepEq(page.entries, [], 'giriş yoxdur')
    ok(page.notes.length > 0, 'səbəb qeyd olunub')
  },

  'the "TEST - N" heading form is recognised too'() {
    const page = parse([
      { str: 'TEST - 12', x: 200, y: 60, w: 80 },
      ...keyRow(100, [
        [1, 'A'],
        [2, 'B'],
        [3, 'C'],
      ]),
      ...keyRow(120, [
        [4, 'D'],
        [5, 'E'],
        [6, 'A'],
      ]),
      ...keyRow(140, [
        [7, 'B'],
        [8, 'C'],
        [9, 'D'],
      ]),
    ])
    ok(
      page.entries.every((e) => e.testNo === 12),
      'testNo başlıqdan götürülür',
    )
  },

  'a question read two ways is dropped, not guessed'() {
    // Keeping the first reading writes a confidently wrong answer, which the
    // pipeline treats as worse than none.
    const page = parse([
      ...keyRow(100, [
        [1, 'A'],
        [2, 'B'],
        [3, 'C'],
      ]),
      ...keyRow(120, [
        [4, 'D'],
        [5, 'E'],
        [6, 'A'],
      ]),
      ...keyRow(140, [
        [7, 'B'],
        [8, 'C'],
        [9, 'D'],
      ]),
      // the same question printed again with a different answer
      ...keyRow(160, [[2, 'E']]),
    ])
    ok(
      !page.entries.some((e) => e.qNo === 2),
      `2 ötürülməlidir: ${JSON.stringify(page.entries.filter((e) => e.qNo === 2))}`,
    )
    ok(
      page.notes.some((n) => n.includes('ziddiyyət')),
      'ziddiyyət qeyd olunub',
    )
  },

  'a page of several tests keeps them apart'() {
    // Real books print a grid of tests on one key page. Read as a single test,
    // every repeated question number looked like a contradiction and the whole
    // page collapsed into test 1.
    const page = parse([
      { str: '1. DENEME', x: 60, y: 60, w: 80 },
      { str: '2. DENEME', x: 320, y: 60, w: 80 },
      ...keyRow(100, [
        [1, 'A'],
        [2, 'B'],
      ], 60, 60),
      ...keyRow(100, [
        [1, 'C'],
        [2, 'D'],
      ], 320, 60),
      ...keyRow(130, [
        [3, 'E'],
        [4, 'A'],
      ], 60, 60),
      ...keyRow(130, [
        [3, 'B'],
        [4, 'C'],
      ], 320, 60),
    ])
    eq(page.entries.length, 8, 'hər iki test saxlanılır')
    const test1 = page.entries.filter((e) => e.testNo === 1)
    const test2 = page.entries.filter((e) => e.testNo === 2)
    deepEq(test1.map((e) => e.answer).join(''), 'ABEA', 'test 1 cavabları')
    deepEq(test2.map((e) => e.answer).join(''), 'CDBC', 'test 2 cavabları')
  },

  'numbers in one row and answers in the row beneath are paired'() {
    // The layout that used to parse to zero entries and be reported as "not a
    // key page", losing the whole book's key.
    const nums = [1, 2, 3, 4, 5, 6, 7, 8, 9]
    const letters = ['A', 'B', 'C', 'D', 'E', 'A', 'B', 'C', 'D']
    const page = parse([
      ...nums.map((n, i) => ({ str: String(n), x: 60 + i * 40, y: 100, w: 12 })),
      ...letters.map((a, i) => ({ str: a, x: 60 + i * 40, y: 124, w: 10 })),
    ])
    eq(page.entries.length, 9, 'giriş sayı')
    deepEq(page.entries.map((e) => e.answer).join(''), letters.join(''), 'cavablar')
  },

  'a gap in the numbering is reported'() {
    const page = parse([
      ...keyRow(100, [
        [1, 'A'],
        [2, 'B'],
        [3, 'C'],
      ]),
      ...keyRow(120, [
        [4, 'D'],
        [5, 'E'],
        [6, 'A'],
      ]),
      // 7 is missing
      ...keyRow(140, [
        [8, 'B'],
        [9, 'C'],
        [10, 'D'],
      ]),
    ])
    ok(
      page.notes.some((n) => n.includes('7')),
      `boşluq qeyd olunub: ${page.notes.join(' | ')}`,
    )
  },
})

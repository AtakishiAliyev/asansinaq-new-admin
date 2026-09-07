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

  // MANTIK 2025: six sections headed "Deneme 1".."Deneme 6" — the number AFTER
  // the word. Nothing matched, so every section collapsed into one, all six
  // answers to question 1 conflicted, and a clean 409-item page produced zero.
  'a header written "Deneme 1" is read as a section'() {
    const page = parse([
      { str: 'Deneme 1', x: 200, y: 40, w: 60 },
      ...keyRow(70, [
        [1, 'D'],
        [2, 'B'],
        [3, 'A'],
      ]),
      ...keyRow(90, [
        [4, 'C'],
        [5, 'E'],
        [6, 'D'],
      ]),
      { str: 'Deneme 2', x: 200, y: 140, w: 60 },
      ...keyRow(170, [
        [1, 'E'],
        [2, 'A'],
        [3, 'C'],
      ]),
      ...keyRow(190, [
        [4, 'B'],
        [5, 'D'],
        [6, 'E'],
      ]),
    ])
    eq(page.entries.length, 12, 'both sections survive instead of conflicting away')
    eq(
      page.entries.filter((e) => e.testNo === 1).map((e) => e.answer).join(''),
      'DBACED',
      'Deneme 1 keeps its own answers',
    )
    eq(
      page.entries.filter((e) => e.testNo === 2).map((e) => e.answer).join(''),
      'EACBDE',
      'and Deneme 2 keeps its own',
    )
  },

  // Why the word-first form is only a FALLBACK. Read eagerly, "DENEME 2" in
  // "1. DENEME   2. DENEME" matches at the WORD and invents a third header
  // between the two real ones, handing the middle column to the wrong test.
  'a side-by-side grid is still read number-first'() {
    const page = parse([
      { str: '1. DENEME', x: 100, y: 40, w: 70 },
      { str: '2. DENEME', x: 400, y: 40, w: 70 },
      ...keyRow(80, [
        [1, 'A'],
        [2, 'B'],
        [3, 'C'],
      ], 100, 60),
      ...keyRow(80, [
        [1, 'E'],
        [2, 'D'],
        [3, 'C'],
      ], 400, 60),
      ...keyRow(110, [
        [4, 'D'],
        [5, 'A'],
        [6, 'B'],
      ], 100, 60),
      ...keyRow(110, [
        [4, 'B'],
        [5, 'E'],
        [6, 'A'],
      ], 400, 60),
    ])
    eq(
      page.entries.filter((e) => e.testNo === 1).map((e) => e.answer).join(''),
      'ABCDAB',
      'the left column is test 1',
    )
    eq(
      page.entries.filter((e) => e.testNo === 2).map((e) => e.answer).join(''),
      'EDCBEA',
      'the right column is test 2, not an invented third header',
    )
  },

  // DENEME 05.04.2025 prints each test as `Test 1 | 1) C 2) C … 10) E` with the
  // rest beneath, so the label shares its row with data. Skipping the whole row
  // — which is what "a header is never data" used to mean — threw away
  // questions 1..10 of every test on all eight key pages of the book: six
  // answers survived of sixteen.
  'a label sharing its row with answers costs only the label'() {
    const cells = (y: number, from: number, to: number, x0: number) =>
      Array.from({ length: to - from + 1 }, (_, i) => ({
        str: `${from + i}) ${'ABCDE'[(from + i) % 5]}`,
        x: x0 + i * 40,
        y,
        w: 30,
      }))
    const page = parse([
      { str: 'Test 1', x: 60, y: 100, w: 40 },
      ...cells(100, 1, 10, 120),
      ...cells(118, 11, 16, 120),
      { str: 'Test 2', x: 60, y: 150, w: 40 },
      ...cells(150, 1, 10, 120),
      ...cells(168, 11, 16, 120),
    ])
    eq(page.entries.length, 32, 'hər iki testin 16 cavabı')
    ok(
      page.entries.filter((e) => e.testNo === 1).some((e) => e.qNo === 1),
      'başlıqla eyni sətirdəki 1-ci sual saxlanılır',
    )
    ok(
      !page.entries.some((e) => e.qNo === 0),
      'başlığın öz nömrəsi cavab kimi oxunmur',
    )
  },

  // Məntiq Magistr OL prints a plain `Cavablar` page: 134 answers, numbers
  // 1..134, no header anywhere. Every consumer keys on the printed block, so
  // leaving the page unnamed meant it parsed perfectly and then placed
  // nothing — 0 of 101 questions on a book whose key is unambiguous.
  'a key page with no header at all is one block'() {
    const page = parse(
      Array.from({ length: 12 }, (_, i) => ({
        str: `${i + 1}. ${'ABCDE'[i % 5]}`,
        x: 60,
        y: 100 + i * 18,
        w: 30,
      })),
    )
    eq(page.entries.length, 12, 'giriş sayı')
    const blocks = [...new Set(page.entries.map((e) => e.sectionId))]
    deepEq(blocks, ['1'], 'hamısı bir blokdadır')
  },

  // Soru Bankası 2025 A prints Test-1 twice on one key page, once per subject.
  // Keyed by the printed number they collided and the conflict rule dropped
  // both: 14 of test 1's 16 answers gone. Keyed by the BLOCK they never meet.
  'two blocks a book gave the same number stay apart'() {
    const page = parse([
      { str: 'Test-1', x: 200, y: 40, w: 50 },
      ...keyRow(70, [
        [1, 'A'],
        [2, 'B'],
        [3, 'C'],
      ]),
      ...keyRow(90, [
        [4, 'D'],
        [5, 'E'],
      ]),
      { str: 'Test-1', x: 200, y: 160, w: 50 },
      ...keyRow(190, [
        [1, 'E'],
        [2, 'D'],
        [3, 'C'],
      ]),
      ...keyRow(210, [
        [4, 'B'],
        [5, 'A'],
      ]),
    ])
    eq(page.entries.length, 10, 'both blocks survive instead of conflicting away')
    ok(
      page.notes.every((n) => !/ziddiyyət/.test(n)),
      'and neither is reported as a disagreement',
    )
    const blocks = [...new Set(page.entries.map((e) => e.sectionId))]
    eq(blocks.length, 2, 'they are two blocks')
    ok(
      page.entries.every((e) => e.testNo === 1),
      'both still carry the number the book printed',
    )
  },
})

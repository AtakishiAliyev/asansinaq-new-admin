import {
  classifyBookPage,
  bookBlocks,
  planBookKey,
  plannedAnswerCount,
  type BookPageRead,
} from '@/core/answer-key/book'
import type { AnswerKeyEntry } from '@/core/answer-key/parse'
import { deepEq, eq, ok, suite } from '../harness.ts'

/** A block of answers as a key page would carry it. */
function block(sectionId: string, from: number, to: number, testNo?: number): AnswerKeyEntry[] {
  const out: AnswerKeyEntry[] = []
  for (let n = from; n <= to; n++) {
    out.push({
      qNo: n,
      answer: 'ABCDE'[n % 5] as AnswerKeyEntry['answer'],
      sectionId,
      ...(testNo !== undefined ? { testNo } : {}),
    })
  }
  return out
}

/** A page of questions numbered `from..to`. */
function questions(pageNumber: number, from: number, to: number, testNo?: number): BookPageRead {
  return {
    pageNumber,
    numbers: Array.from({ length: to - from + 1 }, (_, i) => from + i),
    ...(testNo !== undefined ? { testNo } : {}),
    entries: [],
  }
}

function keyPage(pageNumber: number, entries: AnswerKeyEntry[]): BookPageRead {
  return { pageNumber, numbers: [], entries }
}

export const answerKeyBookSuite = suite('answer-key-book', {
  // The first classifier asked for NO question bands, and a book whose key
  // pages segment into a handful of them reported no key at all: DENEME YY
  // 2025 went from 900 answers to zero on that rule alone.
  'a key page that segments into a few bands is still a key page'() {
    const page: BookPageRead = {
      pageNumber: 249,
      numbers: [1, 2, 3, 4],
      entries: block('1', 1, 30, 1),
    }
    eq(classifyBookPage(page), 'key', 'səhifə növü')
  },

  'a question page is never mistaken for a key page'() {
    eq(classifyBookPage(questions(4, 1, 16)), 'questions', 'səhifə növü')
  },

  'a page with neither is neither'() {
    eq(classifyBookPage({ pageNumber: 2, numbers: [], entries: [] }), 'other', 'səhifə növü')
  },

  // `Q4-10 K11 Q12-18 K19` — Golden Group's shape. Nothing is inferred: the
  // key that follows a run of questions is the key to that run.
  'an interleaved key answers the pages just before it'() {
    const plan = planBookKey([
      questions(4, 1, 20),
      questions(5, 21, 40),
      keyPage(6, block('1', 1, 40)),
      questions(7, 1, 20),
      questions(8, 21, 40),
      keyPage(9, block('1', 1, 40)),
    ])
    eq(plan.layout, 'interleaved', 'quruluş')
    eq(plan.pairings.length, 2, 'cütlük sayı')
    deepEq(plan.pairings[0]!.section.pages, [4, 5], 'birinci bölmənin səhifələri')
    eq(plan.pairings[0]!.block.page, 6, 'birinci bölmənin açarı')
    eq(plan.pairings[1]!.block.page, 9, 'ikinci bölmənin açarı')
  },

  // No questions follow the LAST key page in Golden Group, so asking only
  // about that page read the whole book as a trailing appendix and threw away
  // twelve free positional pairings.
  'a book whose last key ends the book is still interleaved'() {
    const plan = planBookKey([
      questions(4, 1, 25),
      keyPage(5, block('1', 1, 25)),
      questions(6, 1, 25),
      keyPage(7, block('1', 1, 25)),
    ])
    eq(plan.layout, 'interleaved', 'quruluş')
    eq(plan.pairings.length, 2, 'hər iki bölmə yerləşdi')
  },

  'questions printed after the last key are left alone'() {
    const plan = planBookKey([
      questions(4, 1, 25),
      keyPage(5, block('1', 1, 25)),
      questions(6, 1, 25),
    ])
    eq(plan.pairings.length, 1, 'yalnız açarı olan bölmə')
    eq(plan.unpaired.length, 1, 'sonrakı bölmə açarsız qalır')
  },

  // The trailing shape: every key at the back, so the Nth section takes the
  // Nth block. As many sections as blocks is what proves the order.
  'a trailing key is placed section by section, in order'() {
    const plan = planBookKey([
      questions(4, 1, 16, 1),
      questions(5, 1, 16, 2),
      questions(6, 1, 16, 3),
      keyPage(100, [...block('1', 1, 16, 1), ...block('2', 1, 16, 2), ...block('3', 1, 16, 3)]),
    ])
    eq(plan.layout, 'trailing', 'quruluş')
    eq(plan.pairings.length, 3, 'üç bölmə')
    eq(plan.pairings[0]!.block.testNo, 1, 'birinci bölmə birinci bloka')
    eq(plan.pairings[2]!.block.testNo, 3, 'üçüncü bölmə üçüncü bloka')
    eq(plannedAnswerCount(plan), 48, 'cavablanacaq sual')
  },

  // One answer missed on a key page must not cost the whole book. MANTIK 2025
  // has five such blocks, and demanding that every pair prove itself in
  // isolation left all 1,186 of its questions unplaced.
  'a block missing one answer still takes its place in the order'() {
    const pages: BookPageRead[] = []
    const entries: AnswerKeyEntry[] = []
    for (let test = 1; test <= 10; test++) {
      pages.push(questions(3 + test, 1, 16, test))
      const one = block(String(test), 1, 16, test)
      // One block of the ten came back a single answer short.
      entries.push(...(test === 4 ? one.filter((e) => e.qNo !== 9) : one))
    }
    const plan = planBookKey([...pages, keyPage(100, entries)])
    eq(plan.pairings.length, 10, 'hər on bölmə yerləşdi')
    ok(
      plan.notes.some((n) => n.includes('əhatə etmir')),
      `çatışmazlıq bildirilir: ${plan.notes.join(' | ')}`,
    )
  },

  // Two lists of the same length that do not describe each other must not be
  // paired off just because the counts agree.
  'same-length lists that disagree are not paired by count'() {
    const plan = planBookKey([
      questions(4, 1, 16, 1),
      questions(5, 1, 16, 2),
      questions(6, 1, 16, 3),
      // Every block answers a range no section poses.
      keyPage(100, [
        ...block('1', 40, 60, 7),
        ...block('2', 40, 60, 8),
        ...block('3', 40, 60, 9),
      ]),
    ])
    eq(plan.pairings.length, 0, 'heç bir cütlük')
    eq(plan.unpaired.length, 3, 'hamısı operatora qalır')
  },

  // A printed number that positively disagrees is the book contradicting the
  // order, and it is believed over the order.
  'a section is never given a block the book names differently'() {
    const plan = planBookKey([
      questions(4, 1, 16, 1),
      questions(5, 1, 16, 2),
      keyPage(100, [...block('1', 1, 16, 5), ...block('2', 1, 16, 6)]),
    ])
    eq(plan.pairings.length, 0, 'nömrələr uyuşmur, cütlənmir')
  },

  // Where the counts differ, only pairings that hold in EVERY optimal
  // alignment survive — sliding one silently is how a whole book goes wrong.
  'an extra section leaves only the pairings nothing else could claim'() {
    const plan = planBookKey([
      questions(4, 1, 16, 1),
      questions(5, 1, 16, 2),
      questions(6, 1, 16, 3),
      // Only two blocks for three sections, and the numbers name two of them.
      keyPage(100, [...block('1', 1, 16, 1), ...block('2', 1, 16, 3)]),
    ])
    eq(plan.pairings.length, 2, 'adları ilə tanınan iki bölmə')
    eq(plan.unpaired.length, 1, 'qalan bölmə')
    eq(plan.unpaired[0]!.testNo, 2, 'açarda olmayan bölmə')
  },

  'a book with no key page places nothing and says so'() {
    const plan = planBookKey([questions(4, 1, 16), questions(5, 17, 32)])
    eq(plan.layout, 'none', 'quruluş')
    eq(plan.pairings.length, 0, 'cütlük yoxdur')
    ok(plan.notes.some((n) => n.includes('açarı')), 'səbəb bildirilir')
  },

  // An answer belonging to no printed block cannot be placed, and inventing a
  // block for it would write answers onto questions it was never about.
  'an answer belonging to no block is not turned into one'() {
    const orphan: AnswerKeyEntry[] = [
      ...block('1', 1, 25, 1),
      { qNo: 99, answer: 'A' },
    ]
    const blocks = bookBlocks([keyPage(100, orphan)])
    eq(blocks.length, 1, 'blok sayı')
    ok(!blocks[0]!.numbers.has(99), 'sahibsiz cavab bloka qatılmır')
  },
})

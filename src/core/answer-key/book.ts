import type { AnswerKeyEntry } from '@/core/answer-key/parse'
import { splitByNumberingRestart } from '@/core/answer-key/batch'

// Reading a book's printed key ONCE, for the whole book, at import time.
//
// The page-pairing this replaces asked the operator, per batch of crops, which
// pages held the answers and which printed block was meant. That question was
// answerable but tedious, and on a headerless book it had no good answer at
// all: a ten-page selection sees no order and no structure, so the operator
// was being asked to supply what only the whole book knows.
//
// The whole book knows a great deal. Measured over the text-layer corpus, a
// 425-page book reads in about four seconds and lays itself out in one of two
// shapes:
//
//   * INTERLEAVED — `Q4-10 K11 Q12-18 K19 …`. Every key page follows the
//     questions it answers. Golden Group and Məntiq Magistr OL are this shape.
//     Nothing has to be inferred here: position IS the answer.
//   * TRAILING — `… Q407-412 K413-425`. Every key page is at the back. Soru
//     Bankası 2025 A and MANTIK 2025 are this shape, and here the Nth section
//     of the book takes the Nth block of the key.
//
// Order is powerful and it is also the thing that can go silently wrong: shift
// an alignment by one and every answer in the book is confidently wrong, on a
// book where each section numbers 1..16 and so every block "fits" every
// section. That is why nothing here is accepted on plausibility. A pairing is
// kept only when the block answers EVERY number the section carries, and where
// both sides printed a test number those numbers must agree. Where the shape
// gives no such check — a trailing key on a book that heads nothing — the
// counts must match exactly, or the whole book is refused rather than shifted.
//
// Pure: no DOM, no env, no model. The caller supplies what it read.

/** One page of the book, as the importer read it. */
export interface BookPageRead {
  pageNumber: number
  /** Question numbers the segmenter found on the page. */
  numbers: number[]
  /** The test number the page header printed, where it printed one. */
  testNo?: number
  /** Answers parsed from the page, if it is a key page. */
  entries: AnswerKeyEntry[]
}

export type BookPageKind = 'questions' | 'key' | 'other'

/** One printed block of a key page: the unit an answer actually belongs to. */
export interface BookBlock {
  /** Unique across the book — the page makes two first blocks two things. */
  id: string
  page: number
  testNo?: number
  label: string
  numbers: Set<number>
  entries: AnswerKeyEntry[]
}

/** A run of question pages that share one numbering. */
export interface BookSection {
  pages: number[]
  numbers: number[]
  testNo?: number
}

export interface BookPairing {
  section: BookSection
  block: BookBlock
  reason: string
}

export interface BookKeyPlan {
  layout: 'interleaved' | 'trailing' | 'none'
  pairings: BookPairing[]
  /** Sections nothing could be proved for. Never guessed at. */
  unpaired: BookSection[]
  blocks: BookBlock[]
  keyPages: number[]
  notes: string[]
}

/**
 * How many answers a page must hold before it can be a key page at all.
 *
 * The same bar the text parser uses to decide a page is a key table rather
 * than a question page carrying "7 B" fragments.
 */
const MIN_KEY_ANSWERS = 20

/**
 * How much denser than its question bands a key page's answers must be.
 *
 * Requiring NO bands was the first rule and it lost a whole book: DENEME YY
 * 2025's key pages segment into a handful of bands, so a book with four
 * perfectly readable key pages reported none at all. A key table answers many
 * times more questions than any page poses.
 */
const KEY_DENSITY = 3

/**
 * What share of a same-length pairing must hold up on its own before the
 * lengths are taken as proof of the order.
 *
 * Below this the two lists are the same length by coincidence rather than
 * because they describe each other, and a coincidence would shift the book.
 */
const DIRECT_AGREEMENT = 0.8

/** What a page is, from what was read off it. */
export function classifyBookPage(read: BookPageRead): BookPageKind {
  const answers = read.entries.length
  const bands = read.numbers.length
  if (answers >= MIN_KEY_ANSWERS && (bands < 3 || answers >= bands * KEY_DENSITY)) {
    return 'key'
  }
  if (bands >= 3) return 'questions'
  return 'other'
}

/** Every block every key page printed, in the order they are printed. */
export function bookBlocks(reads: BookPageRead[]): BookBlock[] {
  const blocks: BookBlock[] = []
  for (const read of [...reads].sort((a, b) => a.pageNumber - b.pageNumber)) {
    if (classifyBookPage(read) !== 'key') continue
    const grouped = new Map<string, BookBlock>()
    for (const entry of read.entries) {
      // An entry belonging to no printed block cannot be placed, and inventing
      // a block for it would put answers on questions it was never about.
      if (entry.sectionId === undefined) continue
      const id = `${read.pageNumber}-${entry.sectionId}`
      const block =
        grouped.get(id) ??
        ({
          id,
          page: read.pageNumber,
          ...(entry.testNo !== undefined ? { testNo: entry.testNo } : {}),
          label:
            entry.testNo !== undefined
              ? `Test ${entry.testNo}`
              : `s.${read.pageNumber} cavabları`,
          numbers: new Set<number>(),
          entries: [],
        } satisfies BookBlock)
      block.numbers.add(entry.qNo)
      block.entries.push(entry)
      grouped.set(id, block)
    }
    blocks.push(...grouped.values())
  }
  return blocks
}

/** Does this block answer every question the section poses? */
function covers(block: BookBlock, section: BookSection): boolean {
  return section.numbers.length > 0 && section.numbers.every((n) => block.numbers.has(n))
}

/**
 * How good a pairing is: 0 impossible, 1 possible, 2 exact.
 *
 * Coverage alone is nearly no evidence on these books — every section numbers
 * 1..40 and every block answers 1..40, so every block "fits" every section and
 * an alignment can slide freely. A block that answers EXACTLY the numbers the
 * section poses, and nothing else, is a much narrower claim, and ranking it
 * above a loose fit is what pins the alignment down: on MANTIK 2025 the two
 * sections a misread split apart are the only ones left loose, and the other
 * twenty-nine are held in place by their exact matches on both sides.
 */
function pairScore(block: BookBlock, section: BookSection): number {
  if (!covers(block, section) || !testsAgree(block, section)) return 0
  return block.numbers.size === section.numbers.length ? 2 : 1
}

/** Where both sides printed a test number, they have to be the same number. */
function testsAgree(block: BookBlock, section: BookSection): boolean {
  if (block.testNo === undefined || section.testNo === undefined) return true
  return block.testNo === section.testNo
}

/** Build the sections of a run of question pages. */
function sectionsOf(
  pages: number[],
  reads: Map<number, BookPageRead>,
): BookSection[] {
  const numbers = new Map<number, number[]>()
  for (const page of pages) numbers.set(page, reads.get(page)?.numbers ?? [])
  return splitByNumberingRestart(pages, numbers).map((group) => ({
    pages: group,
    numbers: [...new Set(group.flatMap((p) => numbers.get(p) ?? []))].sort((a, b) => a - b),
    ...(() => {
      const printed = group.map((p) => reads.get(p)?.testNo).find((t) => t !== undefined)
      return printed !== undefined ? { testNo: printed } : {}
    })(),
  }))
}

/**
 * Pair sections with blocks in ORDER, keeping only pairings that are FORCED.
 *
 * A plain walk down both lists desynchronises on the first anomaly and then
 * mispairs everything after it, which on this data is the difference between
 * three wrong sections and a hundred and thirty. So the alignment is the one
 * that maximises PROVEN pairs — a pair scores only when the block answers
 * every number the section carries and any printed test numbers agree — and
 * either side may skip.
 *
 * Maximising is not enough on its own, because on these books it is often not
 * unique: MANTIK 2025 has 31 sections against 30 blocks, all of them 40
 * questions answering 1..40, because one section was split in two by a
 * misread. Several different alignments then tie, and picking one silently is
 * how a whole book ends up shifted by one and confidently wrong.
 *
 * So a pairing is kept only where it appears in EVERY optimal alignment: a
 * section with two possible blocks, or a block two sections could claim, is
 * left for a person. On MANTIK that surrenders exactly the two sections around
 * the misread and keeps the other twenty-nine.
 */
function alignInOrder(sections: BookSection[], blocks: BookBlock[]): (BookBlock | null)[] {
  const n = sections.length
  const m = blocks.length
  const score = sections.map((section) => blocks.map((block) => pairScore(block, section)))
  // back[i][j]: most pairs achievable from section i and block j onward.
  const back: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const here = score[i]![j]!
      const paired = here ? here + back[i + 1]![j + 1]! : 0
      back[i]![j] = Math.max(paired, back[i + 1]![j]!, back[i]![j + 1]!)
    }
  }
  // fwd[i][j]: most pairs achievable from the sections and blocks BEFORE i, j.
  const fwd: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const here = score[i - 1]![j - 1]!
      const paired = here ? here + fwd[i - 1]![j - 1]! : 0
      fwd[i]![j] = Math.max(paired, fwd[i - 1]![j]!, fwd[i]![j - 1]!)
    }
  }

  const optimum = back[0]![0]!
  const bySection: number[][] = Array.from({ length: n }, () => [])
  const byBlock: number[][] = Array.from({ length: m }, () => [])
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      // Could this pair belong to an alignment that achieves the optimum?
      const here = score[i]![j]!
      if (here && fwd[i]![j]! + here + back[i + 1]![j + 1]! === optimum) {
        bySection[i]!.push(j)
        byBlock[j]!.push(i)
      }
    }
  }

  const out = new Array<BookBlock | null>(n).fill(null)
  for (let i = 0; i < n; i++) {
    const only = bySection[i]!
    if (only.length !== 1) continue
    const j = only[0]!
    if (byBlock[j]!.length !== 1) continue
    out[i] = blocks[j]!
  }
  return out
}

/**
 * Work out which block of the printed key answers which section of the book.
 *
 * Reads are every page the importer looked at; pages it could not read are
 * simply absent, which is what a scanned page looks like here.
 */
export function planBookKey(reads: BookPageRead[]): BookKeyPlan {
  const byPage = new Map(reads.map((r) => [r.pageNumber, r]))
  const ordered = [...reads].sort((a, b) => a.pageNumber - b.pageNumber)
  const kinds = new Map(ordered.map((r) => [r.pageNumber, classifyBookPage(r)]))
  const keyPages = ordered.filter((r) => kinds.get(r.pageNumber) === 'key').map((r) => r.pageNumber)
  const questionPages = ordered
    .filter((r) => kinds.get(r.pageNumber) === 'questions')
    .map((r) => r.pageNumber)
  const blocks = bookBlocks(ordered)
  const notes: string[] = []

  if (!blocks.length) {
    return {
      layout: 'none',
      pairings: [],
      unpaired: sectionsOf(questionPages, byPage),
      blocks: [],
      keyPages,
      notes: ['Kitabda cavab açarı səhifəsi tapılmadı'],
    }
  }

  // A key page with questions printed AFTER it is not part of a trailing
  // appendix — it is a per-section key, and then position settles everything.
  // Asking only about the LAST key page got this exactly wrong on Golden
  // Group, whose keys alternate with its sections all the way to the final
  // page: no questions follow the last key, so the book read as trailing and
  // its twelve free positional pairings were thrown away for a guess.
  const lastKey = keyPages[keyPages.length - 1]!
  const interleaved = keyPages.some((k) => questionPages.some((p) => p > k))

  const pairings: BookPairing[] = []
  const unpaired: BookSection[] = []

  if (interleaved) {
    let previous = 0
    for (const keyPage of keyPages) {
      const run = questionPages.filter((p) => p > previous && p < keyPage)
      previous = keyPage
      const onPage = blocks.filter((b) => b.page === keyPage)
      if (!run.length || !onPage.length) continue
      // One block answers the whole run; several split it the way the book's
      // own numbering does.
      const sections =
        onPage.length === 1
          ? [
              {
                pages: run,
                numbers: [...new Set(run.flatMap((p) => byPage.get(p)?.numbers ?? []))].sort(
                  (a, b) => a - b,
                ),
                ...(() => {
                  const printed = run.map((p) => byPage.get(p)?.testNo).find((t) => t !== undefined)
                  return printed !== undefined ? { testNo: printed } : {}
                })(),
              },
            ]
          : sectionsOf(run, byPage)
      if (sections.length === onPage.length) {
        sections.forEach((section, index) => {
          const block = onPage[index]!
          // Position is the evidence here, and it is stronger than coverage:
          // the key is printed immediately after the questions it answers.
          // Demanding coverage on top of it threw away whole sections over a
          // few answers a key page had not parsed cleanly — 496 questions on
          // Məntiq Magistr OL, whose keys sit between its sections. A printed
          // test number that positively disagrees is still a veto, because
          // that is the book itself saying otherwise.
          if (testsAgree(block, section)) {
            pairings.push({
              section,
              block,
              reason: `açar s.${keyPage} bu səhifələrdən dərhal sonra gəlir`,
            })
            if (!covers(block, section)) {
              notes.push(
                `s.${keyPage}: açar bu bölmənin bütün nömrələrini əhatə etmir — çatışmayanlar cavabsız qalır`,
              )
            }
          } else unpaired.push(section)
        })
      } else {
        unpaired.push(...sections)
        notes.push(
          `s.${keyPage}: ${onPage.length} blok var, ondan əvvəl ${sections.length} bölmə — uyğunlaşdırılmadı`,
        )
      }
    }
    // Anything after the last key page has no key behind it.
    const trailing = questionPages.filter((p) => p > lastKey)
    if (trailing.length) unpaired.push(...sectionsOf(trailing, byPage))
  } else {
    const sections = sectionsOf(questionPages, byPage)
    const headed =
      sections.every((s) => s.testNo !== undefined) && blocks.every((b) => b.testNo !== undefined)

    // As many sections as the key has blocks IS the proof of order: there is
    // nothing left for a section to be. Coverage cannot carry that weight on
    // its own here — a single answer missed on a key page makes a block stop
    // "covering" its own section, and on MANTIK 2025 five such blocks were
    // enough to leave 1,186 questions unplaced under a rule that demanded
    // every pair be provable in isolation.
    //
    // The count is only proof while the two lists genuinely describe each
    // other, so it is checked: most pairs must still hold up on their own
    // terms, or this is two lists that merely happen to be the same length and
    // the careful alignment decides instead.
    const direct =
      sections.length === blocks.length && sections.length > 0
        ? sections.filter((section, index) => pairScore(blocks[index]!, section) > 0).length
        : 0
    const byCount = direct >= Math.ceil(sections.length * DIRECT_AGREEMENT)

    if (byCount) {
      const loose = sections.filter((s, i) => pairScore(blocks[i]!, s) === 0).length
      sections.forEach((section, index) => {
        pairings.push({
          section,
          block: blocks[index]!,
          reason: `kitabdakı ${sections.length} bölmə açardakı ${blocks.length} bloka sıra ilə düşür`,
        })
      })
      if (loose) {
        notes.push(
          `${loose} bölmədə açar bütün nömrələri əhatə etmir — həmin suallar cavabsız qalacaq`,
        )
      }
    } else {
      const aligned = alignInOrder(sections, blocks)
      sections.forEach((section, index) => {
        const block = aligned[index]
        if (block) {
          pairings.push({
            section,
            block,
            reason: headed
              ? `açardakı ${block.label} bloku ilə sıra üzrə uyğun gəlir`
              : 'açardakı bloklar kitabdakı bölmələrlə eyni sıradadır',
          })
        } else unpaired.push(section)
      })
    }
  }

  if (unpaired.length) {
    notes.push(`${unpaired.length} bölmə üçün blok təsdiqlənmədi — onlara heç nə yazılmır`)
  }
  return {
    layout: interleaved ? 'interleaved' : 'trailing',
    pairings,
    unpaired,
    blocks,
    keyPages,
    notes,
  }
}

/** How many questions a plan would actually answer. */
export function plannedAnswerCount(plan: BookKeyPlan): number {
  return plan.pairings.reduce((n, p) => n + p.section.numbers.length, 0)
}

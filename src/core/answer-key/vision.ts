// What a scanned key page is allowed to have said.
//
// A key page with a text layer is read by `parse.ts`, which refuses a great
// deal: a letter that is not A-E, a number outside any plausible range, a
// question the page answers two ways, a page too sparse to be a key table at
// all. A SCANNED key page is read by a model instead, and until now whatever
// it returned went straight into the pipeline unchecked — so the two paths
// were held to opposite standards, and the looser one is the one that can
// hallucinate.
//
// Five of the nine books in the corpus are pure scans with no text layer on
// any page, so that looser path is not an edge case, it is the majority.
//
// This applies the same rules to the model's answer. It cannot make a misread
// letter right — nothing at this layer can — but it can stop a page that came
// back garbled from being written to questions as fact.
//
// Pure: the rules are the whole point and they are asserted offline.
import type { AnswerKeyEntry } from '@/core/answer-key/parse'

export interface VisionKeyRead {
  entries: AnswerKeyEntry[]
  notes: string[]
}

const LETTERS = new Set(['A', 'B', 'C', 'D', 'E'])

/**
 * How few answers a page may return before the read is reported as suspect.
 *
 * Not a refusal: the operator NAMED this page as a key page, so unlike the
 * text path — which has to decide whether a page it was handed is a key table
 * at all — there is no question of mistaking a question page for one. What a
 * thin result means here is a bad read of a real key page, and that is worth
 * saying out loud beside a preview the operator is about to confirm.
 */
const THIN_READ = 8

/** One raw entry as the model returns it, before anything is believed. */
export interface RawVisionEntry {
  q_no?: unknown
  answer?: unknown
  test_no?: unknown
  /** Which printed block on the page, counting from 1 in reading order. */
  block?: unknown
}

/**
 * Normalise and check what a model read off a scanned key page.
 *
 * Conflicts are keyed by section and number, exactly as the text parser keys
 * them: a page holding four tests prints question 1 four times, and treating
 * those as one question disagreeing with itself would drop the whole page.
 */
export function readVisionKey(raw: RawVisionEntry[]): VisionKeyRead {
  const notes: string[] = []
  const seen = new Map<string, AnswerKeyEntry>()
  const conflicts = new Set<string>()
  let rejected = 0

  // A page on which the model named no test at all is one block, exactly as an
  // unheaded page is on the text path. Without this the scan path produced
  // answers that no page could ever be matched to — and five of the nine books
  // in the corpus have no text layer, so this is the majority path.
  const named = raw.some((item) => typeof item.test_no === 'number')

  for (const item of raw) {
    const qNo = typeof item.q_no === 'number' ? item.q_no : Number(item.q_no)
    const answer = String(item.answer ?? '')
      .trim()
      .toUpperCase()
    const testNo = typeof item.test_no === 'number' ? item.test_no : undefined
    const printed =
      typeof item.block === 'number' &&
      Number.isInteger(item.block) &&
      item.block >= 1
        ? item.block
        : undefined

    if (
      !Number.isInteger(qNo) ||
      qNo < 1 ||
      qNo > 999 ||
      !LETTERS.has(answer)
    ) {
      rejected++
      continue
    }

    // A scan has no geometry to tell two identically-named blocks apart, so
    // the model is asked which block it read from and that answer is preferred
    // over the printed number. It has to be: Soru Bankası 2025 A prints
    // `Test-1` twice on one key page for two subjects, and keyed by the number
    // the two collide and the conflict rule below drops both — on the text
    // path that cost 14 of test 1's 16 answers before blocks existed there.
    //
    // Falling back to the printed number keeps a model that ignores the field
    // no worse than before it was asked for; a page that named nothing at all
    // is the single implicit block, as on the text path.
    const sectionId =
      printed !== undefined
        ? String(printed)
        : testNo !== undefined
          ? String(testNo)
          : named
            ? undefined
            : '1'
    const slot = `${sectionId ?? '0'}:${qNo}`
    if (conflicts.has(slot)) continue
    const existing = seen.get(slot)
    if (existing && existing.answer !== answer) {
      // The same rule the text path follows: a question the page answers two
      // ways is a question this page cannot answer.
      conflicts.add(slot)
      seen.delete(slot)
      continue
    }
    seen.set(slot, {
      qNo,
      answer: answer as AnswerKeyEntry['answer'],
      ...(testNo !== undefined ? { testNo } : {}),
      ...(sectionId !== undefined ? { sectionId } : {}),
    })
  }

  const entries = [...seen.values()].sort(
    (a, b) => (a.testNo ?? 0) - (b.testNo ?? 0) || a.qNo - b.qNo,
  )

  if (rejected) {
    notes.push(
      `${rejected} oxunuş atıldı (cavab A-E deyil və ya nömrə düzgün deyil)`,
    )
  }
  if (conflicts.size) {
    const shown = [...conflicts].slice(0, 5).map((k) => k.split(':')[1])
    notes.push(
      `${conflicts.size} sual üçün ziddiyyətli cavab oxundu (${shown.join(', ')}) — ötürüldü`,
    )
  }
  if (entries.length && entries.length < THIN_READ) {
    notes.push(
      `Yalnız ${entries.length} cavab oxundu — skan səhifəsi zəif oxunmuş ola bilər, gözlə yoxlayın`,
    )
  }
  if (!entries.length) notes.push('Bu skan səhifəsindən cavab oxunmadı')

  // A key table is a dense run per section, so a gap is usually a missed cell
  // rather than a book that skips a number. Counted from 1: a read that lost
  // its opening rows would otherwise look complete.
  const byTest = new Map<number, Set<number>>()
  for (const e of entries) {
    const set = byTest.get(e.testNo ?? 0) ?? new Set<number>()
    set.add(e.qNo)
    byTest.set(e.testNo ?? 0, set)
  }
  for (const [testNo, numbers] of byTest) {
    if (numbers.size <= 2) continue
    const last = Math.max(...numbers)
    const missing: number[] = []
    for (let n = 1; n < last; n++) if (!numbers.has(n)) missing.push(n)
    if (missing.length) {
      const where = testNo ? `Test ${testNo}: ` : ''
      notes.push(
        `${where}oxunmayan nömrələr: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? '…' : ''}`,
      )
    }
  }

  return { entries, notes }
}

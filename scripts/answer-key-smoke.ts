// Does the answer-key path actually read a key page and land on the right rows?
//
//   npm run smoke:answerkey
//
// MANUAL AND OPERATOR-RUN, and it COSTS A LITTLE: one Haiku call per rendered
// key page. Outside the eval and outside the gate because it needs the network.
//
// It exists because the answer-key path crosses four boundaries that are each
// checked separately and never together: the prompt, the Gemini-dialect builder
// that the Edge Function re-expresses for Anthropic, the Zod response schema,
// and the matcher that decides which question each printed answer belongs to.
// A key that parses perfectly and lands on the wrong test is indistinguishable
// from one that worked, until a student sees the wrong answer.
//
// It cannot call the Edge Function: that gates on `is_admin()` and a
// service-role token is deliberately not an admin. So it drives the same prompt
// and the same schema straight at the provider, which covers everything except
// the HTTP wrapper, the budget guard and the ops ledger.
//
// The key page is SYNTHESISED, not a book scan, so this checks the machinery
// rather than any particular book's layout. What it cannot tell you is whether
// a real page of a real book parses; only the operator running the import can.
import Anthropic from '@anthropic-ai/sdk'
import { createCanvas } from '@napi-rs/canvas'
import { createClient } from '@supabase/supabase-js'
import { PARSE_ANSWER_KEY_PROMPT } from '@/core/extract/prompts'
import { parseAnswerKeySchema } from '@/core/extract/schemas'
import { matchAnswerKeys, type KeyBlock, type MatchableQuestion } from '@/core/answer-key/match'
import { samplingFor } from '@/core/models'
import type { Database } from '@/types/database'
import { readEnvFile } from './env-file.ts'

const env = { ...readEnvFile('.env'), ...process.env }
const url = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
const apiKey = env.ANTHROPIC_API_KEY
if (!url || !key || !apiKey) {
  console.error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and ANTHROPIC_API_KEY are required.')
  process.exit(2)
}
const MODEL = env.ANTHROPIC_UTILITY_MODEL ?? 'claude-haiku-4-5'
const db = createClient<Database>(url, key, { auth: { persistSession: false } })
const anthropic = new Anthropic({ apiKey })

/** A printed key table, drawn the way these books print them. */
function keyPage(testNo: number, answers: Record<number, string>): string {
  const W = 700
  // Sized to its own content. A fixed height silently pushed the tail of a long
  // key off the bottom of the page, and the model then "failed to read" entries
  // that had never been drawn — a defect in the test, reported as a defect in
  // the thing under test.
  const perColumn = Math.ceil(Object.keys(answers).length / 3)
  const H = 110 + perColumn * 34 + 30
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#111'
  ctx.font = 'bold 26px DejaVu Sans, Arial'
  ctx.fillText(`${testNo}. DENEME CEVAP ANAHTARI`, 40, 56)

  ctx.font = '20px DejaVu Sans, Arial'
  const entries = Object.entries(answers)
  entries.forEach(([qNo, answer], i) => {
    const col = Math.floor(i / perColumn)
    const row = i % perColumn
    const x = 60 + col * 210
    const y = 110 + row * 34
    ctx.fillText(`${qNo}.`, x, y)
    ctx.fillText(answer, x + 60, y)
    ctx.strokeStyle = '#999'
    ctx.beginPath()
    ctx.moveTo(x - 10, y + 8)
    ctx.lineTo(x + 160, y + 8)
    ctx.stroke()
  })
  return canvas.toBuffer('image/png').toString('base64')
}

async function readKeyPage(image: string): Promise<{ raw: unknown; ms: number }> {
  const started = Date.now()
  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    ...samplingFor(MODEL),
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: image } },
          {
            // Exactly what the Edge Function's shim does: the prompt, then the
            // response schema appended, because Anthropic has no responseSchema
            // for a plain message.
            type: 'text',
            text:
              `${PARSE_ANSWER_KEY_PROMPT}\n\nCavabı YALNIZ bu JSON sxemi ilə ver:\n` +
              JSON.stringify(parseAnswerKeySchema),
          },
        ],
      },
    ],
  })
  const text = message.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
  const trimmed = text.trim()
  let raw: unknown
  try {
    raw = JSON.parse(trimmed)
  } catch {
    const a = trimmed.indexOf('{')
    const b = trimmed.lastIndexOf('}')
    if (a === -1 || b <= a) throw new Error(`no JSON came back: ${trimmed.slice(0, 200)}`)
    raw = JSON.parse(trimmed.slice(a, b + 1))
  }
  return { raw, ms: Date.now() - started }
}

// The books, and a printed key for each, using the question numbers those books
// actually hold so the matcher is exercised against real rows.
const { data: rows } = await db
  .from('questions')
  .select('id, book_id, page_number, col, q_no, test_no')
  .order('book_id')
  .order('q_no')
const { data: books } = await db.from('books').select('id, title')

// Grouped by (book, test), because a key page keys ONE test and a book holds
// several. Grouping by book alone was this harness's own first bug: it keyed
// test 2 and then complained that test 4's questions had not matched, which is
// precisely the behaviour that should happen.
const groups = new Map<string, { bookId: number; testNo: number | null; rows: typeof rows }>()
for (const r of rows ?? []) {
  const k = `${r.book_id}:${r.test_no ?? 'null'}`
  if (!groups.has(k)) groups.set(k, { bookId: r.book_id, testNo: r.test_no, rows: [] })
  groups.get(k)!.rows!.push(r)
}

const ANSWERS = ['A', 'B', 'C', 'D', 'E']
let failures = 0

for (const { bookId, testNo, rows: groupRows } of [...groups.values()].sort(
  (a, b) => a.bookId - b.bookId || (a.testNo ?? 0) - (b.testNo ?? 0),
)) {
  const title = books?.find((b) => b.id === bookId)?.title ?? `book ${bookId}`
  const bookRows = (rows ?? []).filter((r) => r.book_id === bookId)

  // The printed key covers the whole test, as a real one does — the bank holds
  // only the few questions cropped so far, and the rest must simply not match.
  const highest = Math.max(...groupRows!.map((r) => r.q_no))
  const printed: Record<number, string> = {}
  for (let n = 1; n <= highest + 3; n++) printed[n] = ANSWERS[n % 5]!
  const wanted = new Map(groupRows!.map((r) => [r.q_no, printed[r.q_no]!]))

  console.log(`\n=== ${title} — test ${testNo ?? 'unnumbered'} (${wanted.size} question(s) in the bank) ===`)
  const image = keyPage(testNo ?? 1, printed)
  const { raw, ms } = await readKeyPage(image)

  const entries = (raw as { entries?: { q_no: number; answer: string; test_no?: number | null }[] })
    .entries
  if (!Array.isArray(entries)) {
    console.log('  PARSE FAILED — no entries array')
    failures++
    continue
  }
  const printedCount = Object.keys(printed).length
  const readCorrectly = entries.filter((e) => printed[e.q_no] === e.answer).length
  console.log(`  read ${entries.length}/${printedCount} entries in ${ms}ms, ${readCorrectly} with the right letter`)
  if (readCorrectly < printedCount) {
    console.log(`  READ SHORTFALL — the page was not fully read`)
    failures++
  }

  const block: KeyBlock = {
    sourcePage: 999,
    testNo: entries[0]?.test_no ?? testNo ?? undefined,
    entries: entries.map((e) => ({ qNo: e.q_no, answer: e.answer, testNo: e.test_no ?? undefined })),
  } as KeyBlock
  // Matched against the WHOLE book, which is what the app does — the matcher's
  // job includes not straying into another test's questions.
  const matchable: MatchableQuestion[] = bookRows.map((r) => ({
    id: r.id,
    pageNumber: r.page_number,
    col: r.col,
    qNo: r.q_no,
    testNo: r.test_no,
  }))
  const result = matchAnswerKeys([block], matchable)
  const m = result.blocks[0]!
  const rightRow = m.pairs.filter((p) => wanted.get(p.qNo) === p.answer).length
  const strayed = m.pairs.filter((p) => !wanted.has(p.qNo)).length
  console.log(
    `  matched ${m.pairs.length} question(s)` +
      `${m.inferredSection ? ` (via section ${m.inferredSection})` : ''}` +
      `, ${rightRow}/${wanted.size} of this test carrying the right answer` +
      `${strayed ? `, ${strayed} STRAYED into another test` : ''}`,
  )
  if (rightRow !== wanted.size) {
    console.log('  MATCH SHORTFALL — the key read fine but did not reach every question')
    failures++
  }
  if (strayed) {
    console.log('  STRAY MATCH — answers landed on questions this key does not cover')
    failures++
  }
}

console.log(failures ? `\n${failures} problem(s)` : '\nall books read and matched')
process.exit(failures ? 1 : 0)

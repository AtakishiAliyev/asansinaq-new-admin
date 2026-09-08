// The worker loop.
//
//   npm run worker
//
// Two passes, deliberately not one. A batch is answered in minutes or in hours,
// and a loop that waited for its own submission would spend most of its life
// asleep holding rows. So every cycle collects whatever has finished, then
// submits more, then renews what is still out — and none of the three needs the
// others to have happened in the same process.
//
// That is what makes a restart cheap. The batch handle lives on the row, so a
// worker that comes back mid-flight adopts its own outstanding batches on the
// next poll rather than claiming the same questions and buying the same answers
// twice.
import { EMIT_QUESTION_TOOL_NAME } from '@/core/extract/tool-schema'
import { EMIT_VERDICT_TOOL_NAME, parseVerdict } from '@/core/extract/verify-request'
import { config } from './config.ts'
import { closeOcr } from './figure-ocr.ts'
import { runExpress } from './express.ts'
import { shouldExpress } from './pace.ts'
import {
  readExpressOverride,
  announceStart,
  announceStop,
  beat,
  readDesiredState,
  type DesiredState,
} from './control.ts'
import { db, type QuestionRow } from './db.ts'
import { bookContext, forgetBookContexts } from './book-context.ts'
import { batchResults, batchState, submitBatch, type BatchItem } from './batch.ts'
import {
  applyResult,
  cacheInputFor,
  customIdFor,
  downloadCrop,
  EXTRACT_OP,
  idFromCustomId,
  markFailed,
  requestFor,
} from './extract.ts'
import {
  budgetExhausted,
  cacheGet,
  cacheKey,
  cachePut,
  logOp,
  spendToday,
} from './ops.ts'
import { modelFor, warnIfUnpriced } from './models.ts'
import {
  applyVerdict,
  idFromVerifyCustomId,
  VERIFY_OP,
  verifyItemFor,
} from './verify.ts'
import {
  attachBatch,
  claim,
  claimForVerify,
  finish,
  inFlight,
  nextQueuedBook,
  requeue,
  release,
  renew,
  unheld,
} from './queue.ts'

const POLL_MS = 60_000
const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`)

/**
 * How many figures came back as each FigSpec kind, per book.
 *
 * `image` is the kind the model reaches for when no structured kind holds the
 * drawing, and the kind every figure is rerouted to on a `gen` book. A cut
 * book where everything lands there is one where the vector lane is not
 * working, and there is no other signal for that — the questions all look
 * structured. `raw_svg` is no longer offered to the model; it is counted if it
 * ever appears, because its appearance would be the defect.
 */
const figureKindTally = new Map<number, Map<string, number>>()

function noteFigureKinds(row: QuestionRow, wire: Record<string, unknown>): void {
  const figures = Array.isArray(wire.figures) ? wire.figures : []
  const byBook = figureKindTally.get(row.book_id) ?? new Map<string, number>()
  const kinds = figures.length
    ? figures.map((f) => String((f as { kind?: unknown }).kind ?? 'unknown'))
    : ['(none)']
  for (const kind of kinds) byBook.set(kind, (byBook.get(kind) ?? 0) + 1)
  figureKindTally.set(row.book_id, byBook)
}

function reportFigureKinds(): void {
  for (const [bookId, kinds] of figureKindTally) {
    const total = [...kinds.values()].reduce((a, b) => a + b, 0)
    const rawSvg = kinds.get('raw_svg') ?? 0
    const cut = kinds.get('image') ?? 0
    const drawn = total - (kinds.get('(none)') ?? 0)
    const parts = [...kinds.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([kind, n]) => `${kind}=${n}`)
    log(
      `book ${bookId} figures: ${parts.join(' ')}` +
        (drawn
          ? ` — structured ${drawn - cut - rawSvg}/${drawn}, cut ${cut}/${drawn}` +
            (rawSvg ? `, raw_svg ${rawSvg}/${drawn} (should be zero)` : '')
          : ''),
    )
  }
  figureKindTally.clear()
}

/**
 * Whether this process is the always-on daemon or a hand-run drain.
 *
 * The manual path stops when the queue empties, which is what makes it useful
 * during development. The daemon must not: the operator queues work in the UI
 * expecting it to be picked up, and a worker that exited quietly the last time
 * the queue ran dry is indistinguishable from one that crashed.
 */
const DAEMON = process.argv.includes('--daemon') || process.env.WORKER_DAEMON === '1'

/** What the worker is doing, as the control panel will phrase it. */
let activity = 'starting'
let lastBeat = 0
async function setActivity(text: string, state: DesiredState = 'running'): Promise<void> {
  activity = text
  lastBeat = Date.now()
  await beat(db, { activity, state, spendToday: await spendToday(db).catch(() => undefined) })
}

/**
 * How often a long pass says it is still alive.
 *
 * The panel counts a worker offline after 150 seconds of silence, and a beat
 * once per pass was not enough: an express run of 54 questions took 197
 * seconds, and the poll pass cuts, reproduces and OCRs every figure of a
 * batch before it beats again. A healthy worker went "offline" in the UI in
 * the middle of its own run — and a restart is the natural thing to do about
 * an offline worker, which is the one thing a run in progress cannot afford.
 */
const PULSE_MS = 20_000

/** Beat with progress, but no more often than PULSE_MS. Cheap enough to call
 *  after every row. */
async function pulse(text: string): Promise<void> {
  if (Date.now() - lastBeat < PULSE_MS) return
  await setActivity(text).catch(() => {})
}

let stopping = false
/**
 * Wakes the poll sleep early.
 *
 * Without it a stop waits out the full poll interval before the loop comes back
 * round to notice — a minute of a daemon ignoring SIGTERM, which launchd
 * answers with SIGKILL, and a killed process never records that it stopped on
 * purpose. The sleep is interruptible so shutdown is prompt and the heartbeat
 * gets its last word.
 */
let wake: (() => void) | null = null
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => {
      wake = null
      resolve()
    }, ms)
    wake = () => {
      clearTimeout(timer)
      wake = null
      resolve()
    }
  })

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) process.exit(1)
    stopping = true
    wake?.()
    // Rows already submitted are NOT released: their batch is paid for and
    // still coming, and handing them back would let the next worker buy the
    // same answers again. They keep their handle and are adopted on restart.
    log(`${signal} — finishing the current pass, then stopping`)
  })
}

/** Collect anything this worker has outstanding that the provider has finished. */
async function pollPass(): Promise<number> {
  const rows = await inFlight(db)
  if (!rows.length) return 0

  const byBatch = new Map<string, typeof rows>()
  for (const row of rows) {
    if (!row.batch_id) continue
    const bucket = byBatch.get(row.batch_id) ?? []
    bucket.push(row)
    byBatch.set(row.batch_id, bucket)
  }

  let written = 0
  for (const [batchId, batchRows] of byBatch) {
    // The lease is renewed for rows still waiting, so a long batch is not swept
    // out from under itself while the provider is still working.
    await renew(db, batchRows.map((r) => r.id)).catch(() => 0)

    let state
    try {
      state = await batchState(batchId)
    } catch (error) {
      log(`batch ${batchId} unreadable: ${String(error)}`)
      continue
    }
    if (state !== 'ended') {
      log(`batch ${batchId}: ${state}, ${batchRows.length} question(s) waiting`)
      continue
    }

    const stage = batchRows[0]?.batch_stage === 'verify' ? 'verify' : 'extract'
    const byId = new Map(batchRows.map((r) => [r.id, r]))
    // `done` means "this row is finished with, one way or the other". Counting
    // it as work written conflated a structured question with a failed one and
    // reported a batch where every request errored as twelve questions written.
    const done: number[] = []
    /** Mismatched rows that earned another extraction attempt. */
    const repairIds: number[] = []
    let structured = 0
    let failed = 0
    let repaired = 0
    for await (const outcome of batchResults(
      batchId,
      stage === 'verify' ? EMIT_VERDICT_TOOL_NAME : EMIT_QUESTION_TOOL_NAME,
    )) {
      const id =
        stage === 'verify'
          ? idFromVerifyCustomId(outcome.customId)
          : idFromCustomId(outcome.customId)
      const row = id === null ? undefined : byId.get(id)
      if (!row) continue

      if (outcome.usage) {
        await logOp(db, {
          op: stage === 'verify' ? VERIFY_OP : EXTRACT_OP,
          model:
            stage === 'verify'
              ? config.MODEL_VERIFY
              : modelFor(row.figure_kind !== 'none' ? 'figure' : 'text'),
          usage: {
            input: outcome.usage.input_tokens ?? 0,
            cacheWrite: outcome.usage.cache_creation_input_tokens ?? 0,
            cacheRead: outcome.usage.cache_read_input_tokens ?? 0,
            output: outcome.usage.output_tokens ?? 0,
          },
          viaBatch: true,
          cached: false,
        })
      }

      if (!outcome.wire) {
        await markFailed(db, row, outcome.error ?? 'no answer')
        // Surfaced once per batch, not per row: when a whole batch fails it
        // fails for the same one or two reasons, and twelve identical lines
        // bury the one that matters.
        if (failed === 0) log(`  first failure: ${outcome.error ?? 'no answer'}`)
        failed++
        done.push(row.id)
        continue
      }

      if (stage === 'verify') {
        const verdict = parseVerdict(outcome.wire)
        const applied = await applyVerdict(db, row, verdict)
        if (verdict.matches) structured++
        else failed++
        if (applied.repairing) {
          repaired++
          repairIds.push(row.id)
        }
        done.push(row.id)
        written++
        continue
      }

      try {
        const context = await bookContext(db, row.book_id)
        // Downloaded BEFORE the row is written: the picture options are cut out
        // of it. Re-downloaded rather than remembered because this pass may be
        // running in a different process than the one that submitted, and the
        // cache key has to be computed from the same bytes either way.
        const crop = await downloadCrop(db, row)
        const applied = await applyResult(db, row, context, outcome.wire, crop)
        if (applied.status === 'structured') structured++
        else failed++
        noteFigureKinds(row, outcome.wire)
        if (crop) {
          const model = modelFor(row.figure_kind !== 'none' ? 'figure' : 'text')
          await cachePut(
            db,
            cacheKey(EXTRACT_OP, model, cacheInputFor(row, crop, context)),
            EXTRACT_OP,
            model,
            { wire: outcome.wire },
          )
        }
        done.push(row.id)
        written++
      } catch (error) {
        log(`row ${row.id} not applied: ${String(error)}`)
        await markFailed(db, row, String(error).slice(0, 300))
        failed++
        done.push(row.id)
      }
      // Cutting and reproducing figures happens inside applyResult, row by
      // row, so a figure-heavy batch is minutes of silence without this.
      await pulse(`batch ${batchId}: ${done.length}/${batchRows.length} nəticə yazılır`)
    }

    // Anything the provider never mentioned goes back to the queue rather than
    // sitting on a handle for a batch that has already ended.
    const missing = batchRows.filter((r) => !done.includes(r.id)).map((r) => r.id)
    await finish(db, done)
    // After `finish`, never before: it clears queued_at with the rest of the
    // claim, so a repair re-queued any earlier is silently dropped and the row
    // comes back to the verify wave unchanged.
    await requeue(db, repairIds)
    if (missing.length) {
      log(`batch ${batchId}: ${missing.length} row(s) had no result — released`)
      await release(db, missing)
    }
    log(
      stage === 'verify'
        ? `batch ${batchId}: ${structured} verified, ${failed} mismatched` +
            (repaired ? `, ${repaired} sent back for a repair round` : '') +
            (missing.length ? `, ${missing.length} released` : '')
        : `batch ${batchId}: ${structured} structured, ${failed} failed` +
            (missing.length ? `, ${missing.length} released` : ''),
    )
  }
  reportFigureKinds()
  return written
}

/**
 * The second wave: rows the extract wave has finished, compared against their
 * own crop.
 *
 * Deliberately AFTER the extract pass in each cycle, and deliberately using the
 * same claim/lease machinery: a verify batch holds its rows exactly the way an
 * extract batch does, so a worker that dies mid-verification resumes rather
 * than re-comparing. `batch_stage` is what tells the poll pass which kind of
 * answer is coming back.
 */
async function verifyPass(): Promise<number> {
  if (await budgetExhausted(db)) return 0

  // Structured, never ruled on, and not held by anyone LIVE. The partial
  // index on (status, verified_at) covers exactly this. A row whose holder's
  // lease has run out counts as unheld — see `claimForVerify` for why the
  // verify wave has to sweep its own expired leases.
  const { data: candidates } = await db
    .from('questions')
    .select('*')
    .eq('status', 'structured')
    .is('verified_at', null)
    .or(unheld())
    // A row waiting on a repair has not been re-extracted yet, so verifying it
    // again compares the same output to the same crop and reaches the same
    // verdict at full price.
    .is('queued_at', null)
    .order('structured_at')
    .limit(config.BATCH_SIZE)

  const rows = candidates ?? []
  if (!rows.length) return 0

  const items: BatchItem[] = []
  const submitted: { id: number; customId: string }[] = []
  for (const row of rows) {
    try {
      const item = await verifyItemFor(db, row)
      if (!item) continue
      items.push(item)
      submitted.push({ id: row.id, customId: item.customId })
      await pulse(`yoxlama üçün ${items.length}/${rows.length} sual render olunur`)
    } catch (error) {
      // A row that cannot be RENDERED cannot be verified, and that is a real
      // defect rather than a reason to stall the wave: it is marked so a
      // reviewer sees it, and the wave moves on.
      log(`q${row.id} could not be rendered: ${String(error)}`)
      await db
        .from('questions')
        .update({
          verified: false,
          verified_at: new Date().toISOString(),
          verify_confidence: 0,
          verify_diff: [
            { field: 'other', severity: 'critical', note: `render failed: ${String(error).slice(0, 200)}` },
          ] as never,
        })
        .eq('id', row.id)
    }
  }
  if (!items.length) return 0

  // Claimed only once there is something to submit, so a render failure does
  // not take a lease with it.
  let held: number[]
  try {
    held = await claimForVerify(db, submitted.map((s) => s.id))
  } catch (error) {
    log(String(error))
    return 0
  }
  const live = submitted.filter((s) => held.includes(s.id))
  if (!live.length) return 0

  let batchId: string
  try {
    batchId = await submitBatch(items.filter((i) => live.some((l) => l.customId === i.customId)))
  } catch (error) {
    log(`verify submit failed, releasing ${live.length}: ${String(error)}`)
    await release(db, live.map((l) => l.id))
    return 0
  }

  await attachBatch(db, batchId, 'verify', live)
  await setActivity(`batch ${batchId}: ${live.length} sual göndərildi (yoxlama)`)
  log(`batch ${batchId}: submitted ${live.length} question(s) for verification`)
  return live.length
}

/** How many questions are waiting, for the express/batch decision. */
async function queuedCount(): Promise<number> {
  const { count } = await db
    .from('questions')
    .select('id', { count: 'exact', head: true })
    .not('queued_at', 'is', null)
    .is('claimed_at', null)
  return count ?? 0
}

/** Express when the operator asks, or when the set is small enough to watch. */
async function expressWanted(): Promise<boolean> {
  const [queued, override] = await Promise.all([
    queuedCount().catch(() => 0),
    readExpressOverride(db).catch(() => false),
  ])
  return shouldExpress(queued, {
    threshold: config.EXPRESS_THRESHOLD,
    operatorWants: override,
  })
}

/**
 * The whole set, synchronously and without wave barriers.
 *
 * Claiming, finishing and re-queuing stay HERE rather than moving into
 * `express.ts`, because their ordering is load bearing and there must not be
 * two copies of it: `finish` clears `queued_at` along with the rest of the
 * claim, so a repair re-queued before it is silently dropped and the row comes
 * back to be verified again unchanged instead of re-read.
 */
async function expressPass(): Promise<number> {
  if (await budgetExhausted(db)) {
    log(`daily budget of $${config.DAILY_BUDGET_USD} is spent — not running`)
    return 0
  }

  const bookId = await nextQueuedBook(db)
  if (bookId === null) return 0
  let rows = await claim(db, config.BATCH_SIZE, bookId)
  if (!rows.length) rows = await claim(db, config.BATCH_SIZE)
  if (!rows.length) return 0

  const started = Date.now()
  log(
    `express: ${rows.length} question(s), ${config.EXPRESS_CONCURRENCY} at a time ` +
      '— synchronous, full price',
  )
  await setActivity(`express: ${rows.length} sual işlənir (sinxron)`)

  const outcome = await runExpress(db, rows, log, noteFigureKinds, (finished, total) =>
    pulse(`express: ${finished}/${total} sual işlənib`),
  )

  const missing = rows.filter((r) => !outcome.done.includes(r.id)).map((r) => r.id)
  await finish(db, outcome.done)
  await requeue(db, outcome.repairIds)
  if (missing.length) await release(db, missing)

  const seconds = Math.round((Date.now() - started) / 1000)
  log(
    `express: ${outcome.structured} structured, ${outcome.failed} failed, ` +
      `${outcome.verified} verified, ${outcome.mismatched} mismatched` +
      (outcome.repairIds.length ? `, ${outcome.repairIds.length} sent back for a repair` : '') +
      (missing.length ? `, ${missing.length} released` : '') +
      ` — ${seconds}s for ${rows.length} question(s)`,
  )
  reportFigureKinds()
  return outcome.done.length
}

async function submitPass(): Promise<number> {
  if (await budgetExhausted(db)) {
    log(`daily budget of $${config.DAILY_BUDGET_USD} is spent — not submitting`)
    return 0
  }

  const bookId = await nextQueuedBook(db)
  if (bookId === null) return 0

  let rows = await claim(db, config.BATCH_SIZE, bookId)
  if (!rows.length) rows = await claim(db, config.BATCH_SIZE)
  if (!rows.length) return 0

  // Resolved per row, not once per pass: the fallback claim above can return
  // rows from any book, and a tree from the wrong subject produces a category
  // id that exists and is wrong.
  const items: BatchItem[] = []
  const submitted: { id: number; customId: string }[] = []
  const undownloadable: number[] = []
  let served = 0

  for (const row of rows) {
    const crop = await downloadCrop(db, row)
    if (!crop) {
      undownloadable.push(row.id)
      continue
    }
    const rowContext = await bookContext(db, row.book_id)
    const request = requestFor(row, crop.forModel, rowContext)
    const model = modelFor(request.lane)

    // An unchanged crop re-run costs nothing. Checked before submission so a
    // cache hit never enters a batch at all.
    const key = cacheKey(EXTRACT_OP, model, cacheInputFor(row, crop, rowContext))
    const cached = (await cacheGet(db, key)) as { wire?: Record<string, unknown> } | null
    if (cached?.wire) {
      await applyResult(db, row, rowContext, cached.wire, crop)
      // Tallied on this path too: a re-run served entirely from cache would
      // otherwise report no figure coverage at all, which reads as "no figures"
      // rather than "not measured".
      noteFigureKinds(row, cached.wire)
      await logOp(db, {
        op: EXTRACT_OP,
        model,
        usage: { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 },
        viaBatch: true,
        cached: true,
      })
      await finish(db, [row.id])
      served++
      continue
    }

    items.push({ customId: customIdFor(row.id), model, params: request.params })
    submitted.push({ id: row.id, customId: customIdFor(row.id) })
  }

  if (undownloadable.length) {
    // Not failed — the object may be mid-upload. Back to the queue.
    log(`${undownloadable.length} crop(s) could not be downloaded — released`)
    await release(db, undownloadable)
  }
  if (served) log(`${served} question(s) served from cache, unbilled`)
  if (!items.length) {
    reportFigureKinds()
    return served
  }

  let batchId: string
  try {
    batchId = await submitBatch(items)
  } catch (error) {
    log(`submit failed, releasing ${submitted.length}: ${String(error)}`)
    await release(db, submitted.map((s) => s.id))
    return served
  }

  // Written before anything waits on it: this is what a restart reads.
  await attachBatch(db, batchId, 'extract', submitted)
  await setActivity(`batch ${batchId}: ${items.length} sual göndərildi (çıxarış)`)
  // The books the batch ACTUALLY holds, not the one the claim started from: the
  // fallback claim above takes rows from anywhere, so a batch that began with
  // book 22 can end up carrying three books' questions and reporting one.
  const books = [...new Set(rows.map((r) => r.book_id))].sort((a, b) => a - b)
  log(
    `batch ${batchId}: submitted ${items.length} question(s) from ` +
      `book${books.length > 1 ? 's' : ''} ${books.join(', ')}`,
  )
  return served
}

/**
 * `npm run worker -- --dry-run`
 *
 * Pre-flight. Reads, builds the request it WOULD submit, prices it, and exits.
 * It claims nothing, submits nothing and writes nothing — not to the queue, not
 * to the ledger — so it is safe to point at a live queue that is not ready yet.
 *
 * Worth running before every real start: it is the difference between finding
 * out that a crop is missing or a model id is wrong now, and finding out after
 * a few hundred questions have been paid for.
 */
async function dryRun(): Promise<void> {
  log('DRY RUN — nothing will be claimed, submitted, or written')

  // Resume rests entirely on this id being the same one that submitted. Change
  // it and the outstanding batches become invisible: the rows still hold their
  // handles, but no worker recognises them, so the questions are claimed again
  // and a second batch is paid for to learn what the first already knows.
  const mine = await inFlight(db)
  const { count: strays } = await db
    .from('questions')
    .select('id', { count: 'exact', head: true })
    .not('batch_id', 'is', null)
    .neq('claimed_by_worker', config.WORKER_ID)
  log(
    `WORKER_ID=${config.WORKER_ID} — ${mine.length} in-flight row(s) belong to it` +
      (strays ? `, and ${strays} in-flight row(s) belong to ANOTHER worker id` : ''),
  )
  if (strays) {
    log('  ^ if that other id was yours before a restart, resubmitting will pay twice')
  }

  log(`spent today: $${(await spendToday(db)).toFixed(4)} of $${config.DAILY_BUDGET_USD}`)
  log(`budget would ${(await budgetExhausted(db)) ? 'BLOCK' : 'allow'} a submission`)

  const { data: queued } = await db
    .from('questions')
    .select('*')
    .not('queued_at', 'is', null)
    .lt('attempts', 3)
    .order('queued_at')
    .order('id')
    .limit(config.BATCH_SIZE)

  const rows = queued ?? []
  log(`${rows.length} question(s) would be claimed (batch size ${config.BATCH_SIZE})`)
  if (!rows.length) return

  const { anthropic } = await import('./batch.ts')
  let cacheHits = 0
  for (const row of rows) {
    const context = await bookContext(db, row.book_id)
    const crop = await downloadCrop(db, row)
    if (!crop) {
      log(`  q${row.id}: crop ${row.crop_path} NOT DOWNLOADABLE — would be released`)
      continue
    }
    const request = requestFor(row, crop.forModel, context)
    const model = modelFor(request.lane)
    const hit = await cacheGet(
      db,
      cacheKey(EXTRACT_OP, model, cacheInputFor(row, crop, context)),
    )
    if (hit) cacheHits++
    const counted = await anthropic.messages.countTokens({
      model,
      system: request.params.system,
      messages: request.params.messages,
      tools: request.params.tools,
      tool_choice: request.params.tool_choice,
    })
    log(
      `  q${row.id}: lane=${request.lane} model=${model} ` +
        `figure_kind=${row.figure_kind} categories=${context.categories.length} ` +
        `answer_key=${context.answerKeys.size ? 'yes' : 'none'} ` +
        `tokens=${counted.input_tokens}${hit ? ' CACHED (free)' : ''}`,
    )
  }
  log(`${cacheHits} of ${rows.length} would be served from ops_cache, unbilled`)
}

log(`worker ${config.WORKER_ID} starting`)
log(
  `models: text=${config.MODEL_TEXT} figure=${config.MODEL_FIGURE} ` +
    `verify=${config.MODEL_VERIFY}`,
)
// Every model this process will bill, checked ONCE, here, before any of them
// is called. The guard existed and nothing called it, so a mistyped model id
// was priced at the fallback rate in silence — which reads as a cheap model
// rather than an unknown one, on the number the daily budget is enforced from.
for (const model of [
  config.MODEL_TEXT,
  config.MODEL_FIGURE,
  config.MODEL_VERIFY,
  config.GEMINI_IMAGE_MODEL,
  config.OPENAI_IMAGE_MODEL,
]) {
  if (model) warnIfUnpriced(model)
}

if (process.argv.includes('--dry-run')) {
  await dryRun()
  process.exit(0)
}

log(`spent today: $${(await spendToday(db)).toFixed(4)} of $${config.DAILY_BUDGET_USD}`)

await announceStart(db)

let wasPaused = false
while (!stopping) {
  // Read the switch at the top of every pass. A pause therefore lands BETWEEN
  // passes, never inside one: a batch already submitted has already been paid
  // for, and abandoning it mid-flight would spend the money and keep nothing.
  const desired = await readDesiredState(db)
  if (desired === 'paused') {
    if (!wasPaused) log('paused by the operator — waiting for the switch')
    wasPaused = true
    await setActivity('operator tərəfindən dayandırılıb', 'paused')
    await sleep(POLL_MS)
    continue
  }
  if (wasPaused) log('resumed by the operator')
  wasPaused = false

  try {
    await setActivity('növbə yoxlanılır')
    // A pass reads each book once; the next pass reads it again. The lane
    // switch, the tree and the key are all things an operator changes while
    // the daemon is up, and a restart must not be the way they take effect.
    forgetBookContexts()
    // Always first, and in both modes: a batch submitted before the queue got
    // small enough for express is still out there, still paid for, and still
    // has to be collected.
    await pollPass()
    if (await expressWanted()) await expressPass()
    else {
      await submitPass()
      await verifyPass()
    }
  } catch (error) {
    log(`pass failed: ${String(error)}`)
    await beat(db, {
      activity: 'xəta — növbəti dövrədə yenidən cəhd',
      state: 'running',
      lastError: String(error).slice(0, 400),
    })
  }
  if (stopping) break
  const outstanding = (await inFlight(db).catch(() => [])).length
  const queued = await nextQueuedBook(db).catch(() => null)
  // Counted the way `verifyPass` selects, not just "unverified": a row that is
  // queued is waiting to be re-extracted, and the verify wave deliberately
  // leaves it alone. Counting it as work stopped the loop from ever finishing
  // while nothing could act on it — a row stranded at attempts=3 is claimable
  // by nobody and verifiable by nobody, and the worker span on it silently for
  // forty minutes before anyone noticed the log had gone quiet.
  const { count: verifiable } = await db
    .from('questions')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'structured')
    .is('verified_at', null)
    .is('queued_at', null)
  if (!outstanding && queued === null && !verifiable) {
    // Anything left is neither in flight, nor claimable, nor verifiable. That
    // is a stranded row rather than an empty queue, and saying so is the
    // difference between a worker that finished and a worker that gave up.
    const { count: stranded } = await db
      .from('questions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'structured')
      .is('verified_at', null)
    if (stranded) {
      // Said out loud either way: a stranded row is not an empty queue, and a
      // daemon that idles over one would look like it had finished the work.
      log(`${stranded} row(s) are queued but unclaimable — nothing can act on them`)
      await setActivity(`${stranded} sual ilişib — heç bir mərhələ onları götürə bilmir`)
    } else {
      await setActivity('boşdur — yeni iş gözlənilir')
    }
    if (!DAEMON) {
      log(stranded ? 'stopping rather than spinning' : 'queue empty and nothing in flight — stopping')
      break
    }
  }
  await sleep(POLL_MS)
}

await announceStop(db, stopping ? 'signal' : 'queue empty')
// The OCR engine holds a loaded language model and would keep the process
// alive after the loop has finished with it.
await closeOcr()
log('worker stopped')

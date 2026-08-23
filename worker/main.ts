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
import { config } from './config.ts'
import { db } from './db.ts'
import { bookContext } from './book-context.ts'
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
import { modelFor } from './models.ts'
import {
  attachBatch,
  claim,
  finish,
  inFlight,
  nextQueuedBook,
  release,
  renew,
} from './queue.ts'

const POLL_MS = 60_000
const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`)

let stopping = false
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) process.exit(1)
    stopping = true
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

    const byId = new Map(batchRows.map((r) => [r.id, r]))
    const done: number[] = []
    for await (const outcome of batchResults(batchId, EMIT_QUESTION_TOOL_NAME)) {
      const id = idFromCustomId(outcome.customId)
      const row = id === null ? undefined : byId.get(id)
      if (!row) continue

      if (outcome.usage) {
        await logOp(db, {
          op: EXTRACT_OP,
          model: modelFor(row.figure_kind !== 'none' ? 'figure' : 'text'),
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
        done.push(row.id)
        continue
      }

      try {
        const context = await bookContext(db, row.book_id)
        await applyResult(db, row, context, outcome.wire)
        // Re-downloaded rather than remembered: this pass may be running in a
        // different process than the one that submitted, and the cache key has
        // to be computed from the same bytes either way.
        const crop = await downloadCrop(db, row)
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
        done.push(row.id)
      }
    }

    // Anything the provider never mentioned goes back to the queue rather than
    // sitting on a handle for a batch that has already ended.
    const missing = batchRows.filter((r) => !done.includes(r.id)).map((r) => r.id)
    await finish(db, done)
    if (missing.length) {
      log(`batch ${batchId}: ${missing.length} row(s) had no result — released`)
      await release(db, missing)
    }
    log(`batch ${batchId}: ${done.length} question(s) written`)
  }
  return written
}

/** Claim work and put it in front of the provider. */
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
    const request = requestFor(row, crop, rowContext)
    const model = modelFor(request.lane)

    // An unchanged crop re-run costs nothing. Checked before submission so a
    // cache hit never enters a batch at all.
    const key = cacheKey(EXTRACT_OP, model, cacheInputFor(row, crop, rowContext))
    const cached = (await cacheGet(db, key)) as { wire?: Record<string, unknown> } | null
    if (cached?.wire) {
      await applyResult(db, row, rowContext, cached.wire)
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
  if (!items.length) return served

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
  log(`batch ${batchId}: submitted ${items.length} question(s) from book ${bookId}`)
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
    const request = requestFor(row, crop, context)
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
log(`models: text=${config.MODEL_TEXT} figure=${config.MODEL_FIGURE}`)

if (process.argv.includes('--dry-run')) {
  await dryRun()
  process.exit(0)
}

log(`spent today: $${(await spendToday(db)).toFixed(4)} of $${config.DAILY_BUDGET_USD}`)

while (!stopping) {
  try {
    await pollPass()
    await submitPass()
  } catch (error) {
    log(`pass failed: ${String(error)}`)
  }
  if (stopping) break
  const outstanding = (await inFlight(db).catch(() => [])).length
  const queued = await nextQueuedBook(db).catch(() => null)
  if (!outstanding && queued === null) {
    log('queue empty and nothing in flight — stopping')
    break
  }
  await new Promise((resolve) => setTimeout(resolve, POLL_MS))
}

log('worker stopped')

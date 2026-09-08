import { bookContext } from './book-context.ts'
import { config } from './config.ts'
import { db } from './db.ts'
import {
  cacheInputFor,
  downloadCrop,
  EXTRACT_OP,
  requestFor,
} from './extract.ts'
import { log } from './log.ts'
import { modelFor } from './models.ts'
import { budgetExhausted, cacheGet, cacheKey, spendToday } from './ops.ts'
import { inFlight } from './queue.ts'

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
export async function dryRun(): Promise<void> {
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
      (strays
        ? `, and ${strays} in-flight row(s) belong to ANOTHER worker id`
        : ''),
  )
  if (strays) {
    log(
      '  ^ if that other id was yours before a restart, resubmitting will pay twice',
    )
  }

  log(
    `spent today: $${(await spendToday(db)).toFixed(4)} of $${config.DAILY_BUDGET_USD}`,
  )
  log(
    `budget would ${(await budgetExhausted(db)) ? 'BLOCK' : 'allow'} a submission`,
  )

  const { data: queued } = await db
    .from('questions')
    .select('*')
    .not('queued_at', 'is', null)
    .lt('attempts', 3)
    .order('queued_at')
    .order('id')
    .limit(config.BATCH_SIZE)

  const rows = queued ?? []
  log(
    `${rows.length} question(s) would be claimed (batch size ${config.BATCH_SIZE})`,
  )
  if (!rows.length) return

  const { anthropic } = await import('./batch.ts')
  let cacheHits = 0
  for (const row of rows) {
    const context = await bookContext(db, row.book_id)
    const crop = await downloadCrop(db, row)
    if (!crop) {
      log(
        `  q${row.id}: crop ${row.crop_path} NOT DOWNLOADABLE — would be released`,
      )
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
        `answer_key=${context.batchAnswers.size ? 'yes' : 'none'} ` +
        `tokens=${counted.input_tokens}${hit ? ' CACHED (free)' : ''}`,
    )
  }
  log(`${cacheHits} of ${rows.length} would be served from ops_cache, unbilled`)
}

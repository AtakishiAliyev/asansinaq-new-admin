import { setActivity } from './activity.ts'
import { submitBatch, type BatchItem } from './batch.ts'
import { bookContext } from './book-context.ts'
import { config } from './config.ts'
import { db } from './db.ts'
import {
  applyResult,
  cacheInputFor,
  customIdFor,
  downloadCrop,
  EXTRACT_OP,
  requestFor,
} from './extract.ts'
import { noteFigureKinds, reportFigureKinds } from './figure-tally.ts'
import { log } from './log.ts'
import { modelFor } from './models.ts'
import { budgetExhausted, cacheGet, cacheKey, logOp } from './ops.ts'
import { attachBatch, claim, finish, nextQueuedBook, release } from './queue.ts'

/**
 * The first wave: claim queued questions, build one request each, submit them
 * as a batch, and remember the handle on the rows so a restart resumes.
 */
export async function submitPass(): Promise<number> {
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
    const key = cacheKey(
      EXTRACT_OP,
      model,
      cacheInputFor(row, crop, rowContext),
    )
    const cached = (await cacheGet(db, key)) as {
      wire?: Record<string, unknown>
    } | null
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
    await release(
      db,
      submitted.map((s) => s.id),
    )
    return served
  }

  // Written before anything waits on it: this is what a restart reads.
  await attachBatch(db, batchId, 'extract', submitted)
  await setActivity(
    `batch ${batchId}: ${items.length} sual göndərildi (çıxarış)`,
  )
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

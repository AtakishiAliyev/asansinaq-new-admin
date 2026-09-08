import { setActivity, pulse } from './activity.ts'
import { config } from './config.ts'
import { readExpressOverride } from './control.ts'
import { db } from './db.ts'
import { runExpress } from './express.ts'
import { noteFigureKinds, reportFigureKinds } from './figure-tally.ts'
import { log } from './log.ts'
import { budgetExhausted } from './ops.ts'
import { shouldExpress } from './pace.ts'
import { claim, finish, nextQueuedBook, release, requeue } from './queue.ts'

/** How many questions are waiting, for the express/batch decision. */
export async function queuedCount(): Promise<number> {
  const { count } = await db
    .from('questions')
    .select('id', { count: 'exact', head: true })
    .not('queued_at', 'is', null)
    .is('claimed_at', null)
  return count ?? 0
}

/** Express when the operator asks, or when the set is small enough to watch. */
export async function expressWanted(): Promise<boolean> {
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
export async function expressPass(): Promise<number> {
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

  const outcome = await runExpress(
    db,
    rows,
    log,
    noteFigureKinds,
    (finished, total) => pulse(`express: ${finished}/${total} sual işlənib`),
  )

  const missing = rows
    .filter((r) => !outcome.done.includes(r.id))
    .map((r) => r.id)
  await finish(db, outcome.done)
  await requeue(db, outcome.repairIds)
  if (missing.length) await release(db, missing)

  const seconds = Math.round((Date.now() - started) / 1000)
  log(
    `express: ${outcome.structured} structured, ${outcome.failed} failed, ` +
      `${outcome.verified} verified, ${outcome.mismatched} mismatched` +
      (outcome.repairIds.length
        ? `, ${outcome.repairIds.length} sent back for a repair`
        : '') +
      (missing.length ? `, ${missing.length} released` : '') +
      ` — ${seconds}s for ${rows.length} question(s)`,
  )
  reportFigureKinds()
  return outcome.done.length
}

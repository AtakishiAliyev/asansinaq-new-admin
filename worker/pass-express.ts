import { setActivity, pulse } from './activity.ts'
import type { AutoApproveSettings } from '@/core/questions/auto-approve'
import { config } from './config.ts'
import { readExpressOverride } from './control.ts'
import { db } from './db.ts'
import {
  runExpress,
  verifyRowSync,
  type ExpressOutcome,
} from './express.ts'
import { noteFigureKinds, reportFigureKinds } from './figure-tally.ts'
import { log } from './log.ts'
import { budgetExhausted } from './ops.ts'
import { shouldExpress } from './pace.ts'
import {
  claim,
  claimForVerify,
  finish,
  nextQueuedBook,
  release,
  requeue,
  unheld,
} from './queue.ts'
import { mapLimit } from './pace.ts'

/** How many questions are waiting to be STRUCTURED. */
export async function queuedCount(): Promise<number> {
  const { count } = await db
    .from('questions')
    .select('id', { count: 'exact', head: true })
    .not('queued_at', 'is', null)
    .is('claimed_at', null)
  return count ?? 0
}

/**
 * How many are waiting to be VERIFIED — the same rows `verifyPass` selects.
 *
 * Counted for the lane decision because a verdict is work like any other. Left
 * out, a set whose structuring had finished looked like an empty queue, express
 * was never chosen again however the switch was set, and every verdict went to
 * the batch lane: half of one run came back in a minute and half sat in the
 * provider's queue for a quarter of an hour.
 */
export async function awaitingVerifyCount(): Promise<number> {
  const { count } = await db
    .from('questions')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'structured')
    .is('verified_at', null)
    .is('queued_at', null)
    .or(unheld())
  return count ?? 0
}

/** Express when the operator asks, for everything there is to do. */
export async function expressWanted(): Promise<boolean> {
  const [queued, awaiting, override] = await Promise.all([
    queuedCount().catch(() => 0),
    awaitingVerifyCount().catch(() => 0),
    readExpressOverride(db).catch(() => false),
  ])
  return shouldExpress(queued + awaiting, { operatorWants: override })
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
export async function expressPass(
  autoApprove: AutoApproveSettings,
): Promise<number> {
  if (await budgetExhausted(db)) {
    log(`daily budget of $${config.DAILY_BUDGET_USD} is spent — not running`)
    return 0
  }

  const bookId = await nextQueuedBook(db)
  let rows = bookId === null ? [] : await claim(db, config.BATCH_SIZE, bookId)
  if (!rows.length) rows = await claim(db, config.BATCH_SIZE)
  // Nothing left to structure. Anything still unverified was written by a
  // batch, and with express on it is this pass's job too — otherwise the
  // switch would govern half a run and the provider's queue the other half.
  if (!rows.length) return expressVerifyPass(autoApprove)

  const started = Date.now()
  log(
    `express: ${rows.length} question(s), ${config.EXPRESS_CONCURRENCY} at a time ` +
      '— synchronous, full price',
  )
  await setActivity(`express: ${rows.length} sual işlənir (sinxron)`)

  const outcome = await runExpress(
    db,
    rows,
    autoApprove,
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

/**
 * Verify already-structured rows synchronously.
 *
 * The same rows `verifyPass` would have submitted, and claimed the same way, so
 * the two can never both be paying for one comparison. What differs is only
 * where the answer comes from: here, straight away at full price.
 */
async function expressVerifyPass(
  autoApprove: AutoApproveSettings,
): Promise<number> {
  const { data: candidates } = await db
    .from('questions')
    .select('*')
    .eq('status', 'structured')
    .is('verified_at', null)
    .is('queued_at', null)
    .or(unheld())
    .order('structured_at')
    .limit(config.BATCH_SIZE)
  const rows = candidates ?? []
  if (!rows.length) return 0

  // Claimed before a single call is made: the lease is what stops a second
  // worker buying the same verdict.
  let held: number[]
  try {
    held = await claimForVerify(db, rows.map((r) => r.id))
  } catch (error) {
    log(String(error))
    return 0
  }
  const live = rows.filter((r) => held.includes(r.id))
  if (!live.length) return 0

  const started = Date.now()
  log(
    `express verify: ${live.length} question(s), ${config.EXPRESS_CONCURRENCY} ` +
      'at a time — synchronous, full price',
  )
  await setActivity(`express: ${live.length} sual yoxlanılır (sinxron)`)

  let finished = 0
  const parts = await mapLimit(live, config.EXPRESS_CONCURRENCY, async (row) => {
    const part: Partial<ExpressOutcome> = await verifyRowSync(
      db,
      row,
      autoApprove,
      log,
    ).catch((error) => {
      log(`q${row.id} express verify failed: ${String(error)}`)
      return { done: [row.id] }
    })
    await pulse(`express: ${++finished}/${live.length} sual yoxlanılıb`).catch(
      () => {},
    )
    return part
  })

  const done = parts.flatMap((p) => p.done ?? [])
  const repairIds = parts.flatMap((p) => p.repairIds ?? [])
  // Same ordering as the structuring pass, and load bearing for the same
  // reason: `finish` clears `queued_at`, so a repair re-queued before it would
  // be silently dropped and come back unchanged.
  await finish(db, done)
  await requeue(db, repairIds)
  const missing = live.filter((r) => !done.includes(r.id)).map((r) => r.id)
  if (missing.length) await release(db, missing)

  const verified = parts.reduce((a, p) => a + (p.verified ?? 0), 0)
  const mismatched = parts.reduce((a, p) => a + (p.mismatched ?? 0), 0)
  log(
    `express verify: ${verified} verified, ${mismatched} mismatched` +
      (repairIds.length ? `, ${repairIds.length} sent back for a repair` : '') +
      ` — ${Math.round((Date.now() - started) / 1000)}s for ${live.length} question(s)`,
  )
  return done.length
}

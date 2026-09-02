// The worker's half of the queue: the *_worker RPCs from
// 20260823120000_worker_queue.sql, plus the two reads that need no RPC because
// service role can select directly.
//
// Every mutation goes through an RPC rather than a table update, even where a
// table update would work. The RPCs match on claimed_by_worker, so a worker
// can only ever move rows it is actually holding — the browser's finish is a
// bare update any admin session can aim at any row, and that is not a pattern
// worth copying into a process that runs unattended.
import type { Db, QuestionRow } from './db.ts'
import { config } from './config.ts'

/**
 * How long a claim is held before another worker may take it.
 *
 * Sized for the Batches API, not for a batch: submission to results is usually
 * under an hour and allowed 24. The lease is renewed on every poll anyway, so
 * this is the window a worker gets to DIE in without stranding its rows, not
 * the window it expects to need.
 */
export const LEASE = '02:00:00'
/** The same window, for the one claim that is written as a table update. */
const LEASE_MS = 2 * 60 * 60 * 1000

/**
 * "Nobody live is holding this row", as a PostgREST filter.
 *
 * The worker lane always writes `lease_until`, so an expired lease is one whose
 * expiry has passed. Rows never claimed have no `claimed_at` at all. What this
 * does NOT cover is a claim with `claimed_at` and no `lease_until` — the old
 * browser lane's shape — which the browser no longer produces and the verify
 * wave was never meant to take over.
 */
export const unheld = (): string =>
  `claimed_at.is.null,lease_until.lt.${new Date().toISOString()}`

/** Whichever book has waited longest — workers drain one book at a time so the
 *  category tree stays put and its cache block keeps hitting. */
export async function nextQueuedBook(db: Db): Promise<number | null> {
  const { data, error } = await db
    .from('questions')
    .select('book_id')
    .not('queued_at', 'is', null)
    .lt('attempts', 3)
    .order('queued_at')
    .order('id')
    .limit(1)
  if (error) throw new Error(`queue could not be read: ${error.message}`)
  return data?.[0]?.book_id ?? null
}

export async function claim(
  db: Db,
  limit: number,
  bookId?: number,
): Promise<QuestionRow[]> {
  const { data, error } = await db.rpc('claim_questions_worker', {
    p_worker_id: config.WORKER_ID,
    p_limit: limit,
    p_lease: LEASE,
    ...(bookId === undefined ? {} : { p_book_id: bookId }),
  })
  if (error) throw new Error(`claim failed: ${error.message}`)
  return data ?? []
}

export async function renew(db: Db, ids: number[]): Promise<number> {
  if (!ids.length) return 0
  const { data, error } = await db.rpc('renew_claims_worker', {
    p_worker_id: config.WORKER_ID,
    p_ids: ids,
    p_lease: LEASE,
  })
  if (error) throw new Error(`renew failed: ${error.message}`)
  return Number(data ?? 0)
}

/** Hands rows back and returns the attempt — this is not a failed attempt. */
export async function release(db: Db, ids: number[]): Promise<number> {
  if (!ids.length) return 0
  const { data, error } = await db.rpc('release_questions_worker', {
    p_worker_id: config.WORKER_ID,
    p_ids: ids,
  })
  if (error) throw new Error(`release failed: ${error.message}`)
  return Number(data ?? 0)
}

export async function finish(db: Db, ids: number[]): Promise<number> {
  if (!ids.length) return 0
  const { data, error } = await db.rpc('finish_questions_worker', {
    p_worker_id: config.WORKER_ID,
    p_ids: ids,
  })
  if (error) throw new Error(`finish failed: ${error.message}`)
  return Number(data ?? 0)
}

/**
 * Take a lease on specific rows for the verify wave.
 *
 * The extract wave claims by queue order through `claim_questions_worker`;
 * verification already knows which rows it wants, so it asks for those. Same
 * lease, same worker id, same protection against two workers paying for one
 * comparison.
 *
 * It takes over an EXPIRED lease as well as an absent one, which is what the
 * extract RPC does and what this did not: a verify claim sets no `queued_at`,
 * so the extract sweep never touched it, and a worker that died holding a
 * verify batch — or came back under a new WORKER_ID — left its rows claimed
 * forever. Nothing reported them: to the idle check a structured, unverified
 * row is work waiting, so the daemon spun on rows no stage could take. The
 * batch handle of the dead holder is dropped with its lease; the comparison it
 * bought is lost, which is the same price the extract wave pays for a death.
 */
export async function claimForVerify(db: Db, ids: number[]): Promise<number[]> {
  if (!ids.length) return []
  const { data, error } = await db
    .from('questions')
    .update({
      claimed_at: new Date().toISOString(),
      claimed_by_worker: config.WORKER_ID,
      claimed_by: null,
      lease_until: new Date(Date.now() + LEASE_MS).toISOString(),
      batch_id: null,
      batch_custom_id: null,
      batch_stage: null,
    })
    .in('id', ids)
    .or(unheld())
    .select('id')
  if (error) throw new Error(`verify claim failed: ${error.message}`)
  return (data ?? []).map((r) => r.id)
}

/**
 * Writes the batch handle onto the rows it covers.
 *
 * This is the crash-safety hinge of the whole design: once this lands, a worker
 * that dies rediscovers the batch on restart and waits for it, instead of
 * claiming the same questions again and paying a second time for an answer
 * already bought. It is written BEFORE the results are needed, not after.
 */
export async function attachBatch(
  db: Db,
  batchId: string,
  stage: 'extract' | 'verify',
  items: { id: number; customId: string }[],
): Promise<void> {
  for (const item of items) {
    const { error } = await db
      .from('questions')
      .update({
        batch_id: batchId,
        batch_custom_id: item.customId,
        batch_stage: stage,
      })
      .eq('id', item.id)
      .eq('claimed_by_worker', config.WORKER_ID)
    if (error) throw new Error(`batch handle not stored: ${error.message}`)
  }
}

/** Rows this worker is holding that are waiting on a provider batch. */
export async function inFlight(db: Db): Promise<QuestionRow[]> {
  const { data, error } = await db
    .from('questions')
    .select('*')
    .eq('claimed_by_worker', config.WORKER_ID)
    .not('batch_id', 'is', null)
  if (error) throw new Error(`in-flight rows could not be read: ${error.message}`)
  return data ?? []
}

/**
 * Put rows back on the extraction queue.
 *
 * Only safe once the claim is released — `finish` nulls `queued_at` along with
 * the lease and the batch handle, so re-queueing before it undoes itself.
 */
export async function requeue(db: Db, ids: number[]): Promise<void> {
  if (!ids.length) return
  const { error } = await db
    .from('questions')
    .update({
      queued_at: new Date().toISOString(),
      // `attempts` is the TRANSIENT-failure budget — three claims and the row
      // is given up on. A repair is not a retry: it is deliberate new work,
      // already capped by `repair_round`. Spending one budget on the other
      // strands the row at attempts=3, where nothing can claim it and nothing
      // can verify it, and the worker spins on it until someone kills the
      // process. Two budgets, two counters.
      attempts: 0,
    })
    .in('id', ids)
  if (error) throw new Error(`rows could not be re-queued: ${error.message}`)
}

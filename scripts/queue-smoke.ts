// Smoke test for the worker queue RPCs, against the LIVE linked project.
//
//   npm run smoke:queue
//
// MANUAL AND OPERATOR-RUN. This is deliberately not part of `npm run eval` and
// not in the typecheck/lint/build gate: it needs the network and the service
// role key, and eval is free, offline and safe to run on every edit. Nothing
// runs this for you.
//
// RUN IT AFTER ANY MIGRATION THAT TOUCHES the queue RPCs, the lease predicate,
// or the columns either of them reads. The logic it covers cannot be checked
// offline and fails silently in exactly the way that costs money: a worker that
// can claim but not renew looks fine until its lease expires, and then every
// row it was holding is claimed and paid for a second time. That was the
// pre-existing state for a service-role caller, and only a round trip catches
// a regression back into it.
//
// It exercises one real row: claim, renew, release, finish, plus the attempts
// that a second worker must not be allowed to make. It makes no model call and
// writes nothing to ops_log, so it costs nothing.
//
// It leaves the queue as it found it, by two different mechanisms, because one
// was not enough. The exercised row is snapshotted and restored in a finally
// block, and the restore is then re-read rather than assumed. Every OTHER row a
// claim sweeps up — a claim takes everything eligible up to its limit, not just
// the row under test — is released, which is an exact undo for a row that was
// queued and unclaimed. The first version of this file did only the former and
// quietly leased rows it never mentioned, on a queue an operator had just
// filled; the last two checks exist so that cannot recur silently.
//
// Reads the service key from .env, which is gitignored. It never prints it.
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../src/types/database.ts'

const WORKER = 'queue-smoke'
const LEASE = '06:00:00'

function readEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {}
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return out
  }
  for (const line of raw.split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (m?.[1]) out[m[1]] = (m[2] ?? '').replace(/^["']|["']$/g, '')
  }
  return out
}

const env = { ...readEnvFile('.env'), ...process.env }
const url = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error(
    'SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY are required.\n' +
      'The service key is not in .env by default — take it from the Supabase\n' +
      'dashboard (Project Settings → API). It must never be committed.',
  )
  process.exit(2)
}

const db = createClient<Database>(url, key, { auth: { persistSession: false } })

/**
 * A claim takes every eligible row up to its limit, not just the one being
 * exercised — so any OTHER queued row gets swept up as collateral. Releasing
 * it is an exact undo: it was queued and unclaimed before, and release returns
 * it to queued and unclaimed with its attempt given back.
 *
 * This is not hypothetical. Without it the harness leased rows it never
 * reported and never returned, and a real worker then could not touch them
 * until the lease ran out — on a queue the operator had just filled.
 */
async function releaseCollateral(
  workerId: string,
  claimed: { id: number }[] | null | undefined,
  keep: number,
): Promise<number> {
  const ids = (claimed ?? []).map((r) => r.id).filter((rowId) => rowId !== keep)
  if (!ids.length) return 0
  await db.rpc('release_questions_worker', { p_worker_id: workerId, p_ids: ids })
  return ids.length
}

const results: { name: string; pass: boolean; detail?: string }[] = []
const check = (name: string, pass: boolean, detail?: unknown): void => {
  results.push({
    name,
    pass,
    detail: detail === undefined ? undefined : String(detail).slice(0, 160),
  })
}

// The lowest-id row, whatever state it is in. Everything the queue writes is
// captured here so the finally block can put it back exactly.
const { data: picked, error: pickError } = await db
  .from('questions')
  .select(
    'id, status, queued_at, claimed_at, claimed_by, claimed_by_worker, lease_until, attempts, batch_id, batch_custom_id, batch_stage, repair_round',
  )
  .order('id')
  .limit(1)

if (pickError) {
  console.error('service role cannot read questions:', pickError.message)
  process.exit(1)
}
const before = picked?.[0]
if (!before) {
  console.error('no questions in the table to exercise.')
  process.exit(2)
}
const id = before.id
console.log(`exercising question id=${id} against ${url} — it will be restored\n`)

try {
  await db
    .from('questions')
    .update({
      queued_at: new Date().toISOString(),
      claimed_at: null,
      claimed_by: null,
      claimed_by_worker: null,
      lease_until: null,
      batch_id: null,
      batch_custom_id: null,
      batch_stage: null,
      attempts: 0,
    })
    .eq('id', id)

  const { data: claimed, error: claimError } = await db.rpc('claim_questions_worker', {
    p_worker_id: WORKER,
    p_limit: 5,
    p_lease: LEASE,
  })
  check('service_role can call claim_questions_worker', !claimError, claimError?.message)
  const sweptUp = await releaseCollateral(WORKER, claimed, id)
  if (sweptUp) console.log(`  (released ${sweptUp} row(s) claimed alongside the target)`)
  const got = (claimed ?? []).find((r) => r.id === id)
  check('the claim returned the queued row', Boolean(got))
  check('claimed_by_worker holds the worker id', got?.claimed_by_worker === WORKER)
  check('claimed_by stays null so the two lanes cannot collide', got?.claimed_by === null)
  check('the claim burned an attempt', got?.attempts === 1, `attempts=${got?.attempts}`)

  if (got?.lease_until && got.claimed_at) {
    const hours =
      (new Date(got.lease_until).getTime() - new Date(got.claimed_at).getTime()) / 3.6e6
    check(
      'the lease honours the interval it was given, not the 15-minute default',
      hours > 5.9 && hours < 6.1,
      `${hours.toFixed(2)}h`,
    )
  } else {
    check('the lease honours the interval it was given', false, 'lease_until not set')
  }

  // A lease is ownership. Another worker must not be able to take it away.
  const { data: stolenRenew } = await db.rpc('renew_claims_worker', {
    p_worker_id: 'other-worker',
    p_ids: [id],
    p_lease: LEASE,
  })
  check('another worker cannot renew this row', stolenRenew === 0, `rows=${stolenRenew}`)

  const { data: stolenRelease } = await db.rpc('release_questions_worker', {
    p_worker_id: 'other-worker',
    p_ids: [id],
  })
  check('another worker cannot release this row', stolenRelease === 0, `rows=${stolenRelease}`)

  // The one that was structurally impossible before: under the browser RPCs a
  // service-role caller matched `claimed_by = auth.uid()` as `null = null` and
  // renewed nothing.
  const { data: renewed, error: renewError } = await db.rpc('renew_claims_worker', {
    p_worker_id: WORKER,
    p_ids: [id],
    p_lease: LEASE,
  })
  check(
    'the holder can renew its own claim',
    !renewError && renewed === 1,
    renewError?.message ?? `rows=${renewed}`,
  )

  const { data: second } = await db.rpc('claim_questions_worker', {
    p_worker_id: 'second-worker',
    p_limit: 5,
    p_lease: LEASE,
  })
  check(
    'a row under a live lease is not handed to a second worker',
    !(second ?? []).some((r) => r.id === id),
  )
  // The impostor claims under its OWN id, so its collateral has to be handed
  // back under that id too — the target's holder cannot release rows it never
  // held.
  await releaseCollateral('second-worker', second, id)

  const { data: released, error: releaseError } = await db.rpc('release_questions_worker', {
    p_worker_id: WORKER,
    p_ids: [id],
  })
  check(
    'the holder can release its own claim',
    !releaseError && released === 1,
    releaseError?.message ?? `rows=${released}`,
  )

  const { data: afterRelease } = await db
    .from('questions')
    .select('attempts, claimed_by_worker, lease_until, queued_at')
    .eq('id', id)
    .single()
  check(
    'releasing returns the attempt — stopping is not a failed attempt',
    afterRelease?.attempts === 0,
    `attempts=${afterRelease?.attempts}`,
  )
  check(
    'releasing clears the worker lease',
    afterRelease?.claimed_by_worker === null && afterRelease?.lease_until === null,
  )
  check('releasing leaves the row queued for the next worker', afterRelease?.queued_at !== null)

  const { data: reclaimed } = await db.rpc('claim_questions_worker', {
    p_worker_id: WORKER,
    p_limit: 5,
    p_lease: LEASE,
  })
  await releaseCollateral(WORKER, reclaimed, id)
  const { data: finished, error: finishError } = await db.rpc('finish_questions_worker', {
    p_worker_id: WORKER,
    p_ids: [id],
  })
  check(
    'the holder can finish its own claim',
    !finishError && finished === 1,
    finishError?.message ?? `rows=${finished}`,
  )

  const { data: afterFinish } = await db
    .from('questions')
    .select('queued_at, claimed_at, claimed_by_worker, batch_id')
    .eq('id', id)
    .single()
  check(
    'finishing takes the row out of the queue',
    afterFinish?.queued_at === null && afterFinish?.claimed_at === null,
  )
  check('finishing clears the batch handle', afterFinish?.batch_id === null)
} finally {
  // Unconditional: a failed assertion must not leave a row claimed by a worker
  // that will never come back for it.
  const { error: restoreError } = await db
    .from('questions')
    .update({
      status: before.status,
      queued_at: before.queued_at,
      claimed_at: before.claimed_at,
      claimed_by: before.claimed_by,
      claimed_by_worker: before.claimed_by_worker,
      lease_until: before.lease_until,
      attempts: before.attempts,
      batch_id: before.batch_id,
      batch_custom_id: before.batch_custom_id,
      batch_stage: before.batch_stage,
      repair_round: before.repair_round,
    })
    .eq('id', id)
  check('the exercised row was restored', !restoreError, restoreError?.message)

  // Re-read rather than trust the write. An update that reports no error can
  // still have restored the wrong values, and this harness has already shipped
  // once claiming to leave the queue as it found it while it did not.
  const { data: after } = await db
    .from('questions')
    .select('queued_at, claimed_at, claimed_by_worker, lease_until, attempts, batch_id')
    .eq('id', id)
    .single()
  check(
    'the restore actually took',
    after?.claimed_by_worker === before.claimed_by_worker &&
      after?.lease_until === before.lease_until &&
      after?.attempts === before.attempts &&
      after?.queued_at === before.queued_at,
    `claimed_by_worker=${after?.claimed_by_worker} attempts=${after?.attempts}`,
  )

  // Nothing may be left leased under this harness's identity, whatever path
  // the run took to get here.
  const { data: stragglers } = await db
    .from('questions')
    .select('id')
    .in('claimed_by_worker', [WORKER, 'second-worker', 'other-worker'])
  check(
    'no row is left leased to the harness',
    (stragglers ?? []).length === 0,
    (stragglers ?? []).map((r) => r.id).join(',') || undefined,
  )
}

let failed = 0
for (const r of results) {
  if (!r.pass) failed++
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  [${r.detail}]` : ''}`)
}
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)

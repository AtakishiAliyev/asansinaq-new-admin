import {
  autoApprovable,
  type AutoApproveSettings,
} from '@/core/questions/auto-approve'
import { setActivity, pulse } from './activity.ts'
import { submitBatch, type BatchItem } from './batch.ts'
import { config } from './config.ts'
import { db } from './db.ts'
import { log } from './log.ts'
import { budgetExhausted } from './ops.ts'
import { attachBatch, claimForVerify, release, unheld } from './queue.ts'
import { verifyItemFor } from './verify.ts'

/**
 * Approve, by rule, rows the wave has already ruled on.
 *
 * `applyVerdict` applies the rule at the moment it writes a verdict, which is
 * the right place and covers nothing that was verified earlier — including
 * every row already in the bank when the operator turns the switch on. The
 * rule is the rule whenever the row was read, so this sweeps the ones the
 * verdict path could no longer reach.
 *
 * Bounded per pass, and guarded on `status = 'structured'` in the update so a
 * row a reviewer ruled on between the read and the write is never overwritten.
 */
export async function autoApprovePass(
  autoApprove: AutoApproveSettings,
): Promise<number> {
  if (!autoApprove.enabled) return 0

  const { data: candidates, error } = await db
    .from('questions')
    .select('id, status, verified, answer, category_id, flags')
    .eq('status', 'structured')
    .eq('verified', true)
    // A row waiting to be re-read has not finished; the verdict it carries
    // belongs to content that is about to be replaced.
    .is('queued_at', null)
    .not('verified_at', 'is', null)
    .order('verified_at')
    .limit(AUTO_APPROVE_SWEEP)
  if (error) {
    log(`auto-approve sweep could not read: ${error.message}`)
    return 0
  }

  const ids = (candidates ?? [])
    .filter((row) => autoApprovable(row, autoApprove))
    .map((r) => r.id)
  if (!ids.length) return 0

  const { error: writeError } = await db
    .from('questions')
    .update({
      status: 'approved',
      auto_approved: true,
      reviewed_at: new Date().toISOString(),
    })
    .in('id', ids)
    .eq('status', 'structured')
  if (writeError) {
    log(`auto-approve sweep failed: ${writeError.message}`)
    return 0
  }
  log(`auto-approve: ${ids.length} row(s) approved by rule`)
  return ids.length
}

/** How many already-verified rows one pass may approve. Bounded so turning the
 *  switch on does not become one enormous write. */
const AUTO_APPROVE_SWEEP = 200

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
export async function verifyPass(): Promise<number> {
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
      await pulse(
        `yoxlama üçün ${items.length}/${rows.length} sual render olunur`,
      )
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
            {
              field: 'other',
              severity: 'critical',
              note: `render failed: ${String(error).slice(0, 200)}`,
            },
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
    held = await claimForVerify(
      db,
      submitted.map((s) => s.id),
    )
  } catch (error) {
    log(String(error))
    return 0
  }
  const live = submitted.filter((s) => held.includes(s.id))
  if (!live.length) return 0

  let batchId: string
  try {
    batchId = await submitBatch(
      items.filter((i) => live.some((l) => l.customId === i.customId)),
    )
  } catch (error) {
    log(`verify submit failed, releasing ${live.length}: ${String(error)}`)
    await release(
      db,
      live.map((l) => l.id),
    )
    return 0
  }

  await attachBatch(db, batchId, 'verify', live)
  await setActivity(
    `batch ${batchId}: ${live.length} sual göndərildi (yoxlama)`,
  )
  log(`batch ${batchId}: submitted ${live.length} question(s) for verification`)
  return live.length
}

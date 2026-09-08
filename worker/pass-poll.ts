import { EMIT_QUESTION_TOOL_NAME } from '@/core/extract/tool-schema'
import {
  EMIT_VERDICT_TOOL_NAME,
  parseVerdict,
} from '@/core/extract/verify-request'
import { pulse } from './activity.ts'
import { batchResults, batchState } from './batch.ts'
import { bookContext } from './book-context.ts'
import { config } from './config.ts'
import { db } from './db.ts'
import {
  applyResult,
  cacheInputFor,
  downloadCrop,
  EXTRACT_OP,
  idFromCustomId,
  markFailed,
} from './extract.ts'
import { noteFigureKinds, reportFigureKinds } from './figure-tally.ts'
import { log } from './log.ts'
import { modelFor } from './models.ts'
import { cacheKey, cachePut, logOp } from './ops.ts'
import { finish, inFlight, release, renew, requeue } from './queue.ts'
import { applyVerdict, idFromVerifyCustomId, VERIFY_OP } from './verify.ts'

/** Collect anything this worker has outstanding that the provider has finished. */
export async function pollPass(): Promise<number> {
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
    await renew(
      db,
      batchRows.map((r) => r.id),
    ).catch(() => 0)

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
        if (failed === 0)
          log(`  first failure: ${outcome.error ?? 'no answer'}`)
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
      await pulse(
        `batch ${batchId}: ${done.length}/${batchRows.length} nəticə yazılır`,
      )
    }

    // Anything the provider never mentioned goes back to the queue rather than
    // sitting on a handle for a batch that has already ended.
    const missing = batchRows
      .filter((r) => !done.includes(r.id))
      .map((r) => r.id)
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

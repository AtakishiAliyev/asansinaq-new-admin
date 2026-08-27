// Express mode: the same work, synchronously, pipelined per question.
//
// WHY IT EXISTS. Batch is half price and is the right default for a queue that
// drains overnight, but its latency does not scale down. Measured on this
// project's own log, eight figure questions took 1099 seconds end to end and
// 935 of those — 85% — were spent waiting in the provider's queue across two
// waves. A batch of one waits as long as a batch of fifty. So for a set small
// enough that an operator is sitting in front of it, paying full price to skip
// the queue is plainly the better trade.
//
// WHAT MAKES IT FAST is not only the synchronous call. It is the absence of
// WAVE BARRIERS. The batch path runs every question through extraction, waits
// for the slowest, then runs every question through verification: two queues,
// and the whole set moves at the pace of its worst member. Here each question
// runs its own extract → figure → verify chain and is finished with as soon as
// its own chain is done, so the run takes as long as the slowest QUESTION
// rather than the sum of the slowest step in each wave.
//
// It deliberately reuses `applyResult`, `applyVerdict`, the cache and the
// ledger unchanged. Express must not be a second reading of a crop that could
// disagree with the batch reading — it is the same work with the waiting taken
// out.
import { config } from './config.ts'
import { mapLimit } from './pace.ts'
import type { Db, QuestionRow } from './db.ts'
import { runSync, type BatchItem } from './batch.ts'
import { bookContext } from './book-context.ts'
import { modelFor } from './models.ts'
import { budgetExhausted, cacheGet, cacheKey, cachePut, logOp } from './ops.ts'
import {
  applyResult,
  cacheInputFor,
  customIdFor,
  downloadCrop,
  EXTRACT_OP,
  markFailed,
  requestFor,
} from './extract.ts'
import {
  applyVerdict,
  EMIT_VERDICT_TOOL_NAME,
  parseVerdict,
  verifyItemFor,
  VERIFY_OP,
} from './verify.ts'
import { EMIT_QUESTION_TOOL_NAME } from '@/core/extract/tool-schema'

export interface ExpressOutcome {
  structured: number
  failed: number
  verified: number
  mismatched: number
  /** Rows a mismatch earned another extraction attempt. */
  repairIds: number[]
  /** Rows that finished, however they finished. */
  done: number[]
}

/**
 * One question, all the way through: extract → figures → verify.
 *
 * The budget is re-checked BEFORE each question starts, and never inside one.
 *
 * Both halves matter. Express claims a whole set and pays the synchronous rate
 * for it, so a single check at the top of the pass would let a large set — the
 * operator's override allows one — run well past the cap before anyone noticed.
 * But a check between a question's extract and its verify would leave a
 * structured row with no verdict, which is the one state the review queue
 * cannot interpret. So the cap stops the NEXT question, never the current one.
 */
async function runOne(
  db: Db,
  row: QuestionRow,
  log: (message: string) => void,
  onWire: (row: QuestionRow, wire: Record<string, unknown>) => void,
): Promise<Partial<ExpressOutcome>> {
  if (await budgetExhausted(db).catch(() => false)) {
    // Released, not failed: the row is untouched and the next run picks it up.
    return {}
  }
  const crop = await downloadCrop(db, row)
  if (!crop) {
    // Not failed: the object may be mid-upload. The caller releases it.
    return {}
  }
  const context = await bookContext(db, row.book_id)
  const request = requestFor(row, crop, context)
  const model = modelFor(request.lane)

  let wire: Record<string, unknown> | null = null
  const key = cacheKey(EXTRACT_OP, model, cacheInputFor(row, crop, context))
  const cached = (await cacheGet(db, key)) as {
    wire?: Record<string, unknown>
  } | null
  if (cached?.wire) {
    wire = cached.wire
    await logOp(db, {
      op: EXTRACT_OP,
      model,
      usage: { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 },
      viaBatch: false,
      cached: true,
    })
  } else {
    const started = Date.now()
    const item: BatchItem = {
      customId: customIdFor(row.id),
      model,
      params: request.params,
    }
    const outcome = await runSync(item, EMIT_QUESTION_TOOL_NAME)
    if (outcome.usage) {
      await logOp(db, {
        op: EXTRACT_OP,
        model,
        usage: {
          input: outcome.usage.input_tokens ?? 0,
          cacheWrite: outcome.usage.cache_creation_input_tokens ?? 0,
          cacheRead: outcome.usage.cache_read_input_tokens ?? 0,
          output: outcome.usage.output_tokens ?? 0,
        },
        viaBatch: false,
        cached: false,
        ms: Date.now() - started,
      })
    }
    if (!outcome.wire) {
      await markFailed(db, row, outcome.error ?? 'no answer')
      log(`q${row.id} extract failed: ${outcome.error ?? 'no answer'}`)
      return { failed: 1, done: [row.id] }
    }
    wire = outcome.wire
    await cachePut(db, key, EXTRACT_OP, model, { wire })
  }

  // Figure cutting and the guarded reproduction happen inside this call, so a
  // question's Gemini work overlaps with the NEXT question's extraction rather
  // than waiting for a wave to finish.
  onWire(row, wire)
  const applied = await applyResult(db, row, context, wire, crop)
  if (applied.status !== 'structured') {
    return { failed: 1, done: [row.id] }
  }

  // The row as it now stands, because verification renders what was just
  // written — not what was claimed at the top of the pass.
  const { data: fresh } = await db
    .from('questions')
    .select('*')
    .eq('id', row.id)
    .maybeSingle()
  if (!fresh) return { structured: 1, done: [row.id] }

  let verifyItem
  try {
    verifyItem = await verifyItemFor(db, fresh)
  } catch (error) {
    log(`q${row.id} could not be rendered: ${String(error)}`)
    verifyItem = null
  }
  if (!verifyItem) return { structured: 1, done: [row.id] }

  const started = Date.now()
  const verdictOutcome = await runSync(verifyItem, EMIT_VERDICT_TOOL_NAME)
  if (verdictOutcome.usage) {
    await logOp(db, {
      op: VERIFY_OP,
      model: config.MODEL_VERIFY,
      usage: {
        input: verdictOutcome.usage.input_tokens ?? 0,
        cacheWrite: verdictOutcome.usage.cache_creation_input_tokens ?? 0,
        cacheRead: verdictOutcome.usage.cache_read_input_tokens ?? 0,
        output: verdictOutcome.usage.output_tokens ?? 0,
      },
      viaBatch: false,
      cached: false,
      ms: Date.now() - started,
    })
  }
  if (!verdictOutcome.wire) {
    // Structured but unjudged. The row stays unverified, which is already the
    // state the review queue understands.
    log(`q${row.id} verify failed: ${verdictOutcome.error ?? 'no answer'}`)
    return { structured: 1, done: [row.id] }
  }

  const verdict = parseVerdict(verdictOutcome.wire)
  const result = await applyVerdict(db, fresh, verdict)
  return {
    structured: 1,
    verified: verdict.matches ? 1 : 0,
    mismatched: verdict.matches ? 0 : 1,
    repairIds: result.repairing ? [row.id] : [],
    done: [row.id],
  }
}

/**
 * A whole claimed set, pipelined.
 *
 * Returns what happened rather than writing the queue itself, so the caller
 * keeps the claim/finish/requeue ordering it already has — that ordering is
 * load bearing (`finish` clears `queued_at`, so a repair re-queued before it is
 * silently dropped) and there must not be two copies of it.
 */
export async function runExpress(
  db: Db,
  rows: QuestionRow[],
  log: (message: string) => void,
  onWire: (row: QuestionRow, wire: Record<string, unknown>) => void = () => {},
): Promise<ExpressOutcome> {
  const parts = await mapLimit(rows, config.EXPRESS_CONCURRENCY, (row) =>
    runOne(db, row, log, onWire).catch((error): Partial<ExpressOutcome> => {
      log(`q${row.id} express failed: ${String(error)}`)
      return { failed: 1, done: [row.id] }
    }),
  )
  return {
    structured: parts.reduce((a, p) => a + (p.structured ?? 0), 0),
    failed: parts.reduce((a, p) => a + (p.failed ?? 0), 0),
    verified: parts.reduce((a, p) => a + (p.verified ?? 0), 0),
    mismatched: parts.reduce((a, p) => a + (p.mismatched ?? 0), 0),
    repairIds: parts.flatMap((p) => p.repairIds ?? []),
    done: parts.flatMap((p) => p.done ?? []),
  }
}

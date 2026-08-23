// The ledger, the cache and the cap — the three things that keep a queue of
// thousands of paid calls from being a surprise at the end of the month.
//
// All three already exist and are enforced server-side; this file is the
// worker's half of contracts the Edge Function has been keeping since before
// there was a worker. The shapes match deliberately, so the ops page keeps
// showing one pipeline rather than two.
import { createHash } from 'node:crypto'
import { PROMPT_VERSION } from '@/core/extract/prompts'
import type { Db } from './db.ts'
import { config } from './config.ts'
import { estimateCost, promptTokens, type TokenUsage } from './models.ts'

export async function spendToday(db: Db): Promise<number> {
  const { data, error } = await db.rpc('ops_spend_today')
  if (error) throw new Error(`spend could not be read: ${error.message}`)
  return Number(data ?? 0)
}

/**
 * Checked before a batch is SUBMITTED, not before results are collected.
 *
 * The asymmetry is deliberate and matches the Edge Function's rule: refusing to
 * spend more is right, but refusing to bank work already paid for turns a
 * capped day into lost money. Results of an in-flight batch are always written.
 */
export async function budgetExhausted(db: Db): Promise<boolean> {
  return (await spendToday(db)) >= config.DAILY_BUDGET_USD
}

export async function logOp(
  db: Db,
  entry: {
    op: string
    model: string
    usage: TokenUsage
    viaBatch: boolean
    cached: boolean
    ms?: number | null
  },
): Promise<void> {
  const { error } = await db.from('ops_log').insert({
    op: entry.op,
    model: entry.model,
    prompt_tokens: promptTokens(entry.usage),
    output_tokens: entry.usage.output,
    // Provider-reported cache hits. Our own cost column is computed from token
    // counts, so a discount applied upstream is invisible without this.
    cached_tokens: entry.usage.cacheRead,
    // Batch results carry no per-request duration, and dividing the batch's
    // wall clock by its size would invent one. Null is the honest answer.
    ms: entry.ms ?? null,
    est_cost_usd: entry.cached
      ? 0
      : estimateCost(entry.model, entry.usage, entry.viaBatch),
    cached: entry.cached,
    // No person made this call. created_by references profiles, and inventing
    // an admin here would make the audit trail lie.
    created_by: null,
  })
  // A ledger write that fails must not lose the work it was describing.
  if (error) console.warn(`[ops] ledger write failed: ${error.message}`)
}

/**
 * Keyed by everything that could change the answer, including the resolved
 * model and the prompt version — so swapping MODEL_TEXT or editing a prompt
 * starts a fresh generation instead of replaying the old one's output.
 */
export function cacheKey(op: string, model: string, input: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify({ v: PROMPT_VERSION, m: model, op, input }))
    .digest('hex')
}

export async function cacheGet(db: Db, key: string): Promise<unknown | null> {
  const { data, error } = await db
    .from('ops_cache')
    .select('response')
    .eq('key', key)
    .maybeSingle()
  if (error || !data) return null
  return data.response ?? null
}

export async function cachePut(
  db: Db,
  key: string,
  op: string,
  model: string,
  response: unknown,
): Promise<void> {
  const { error } = await db.from('ops_cache').insert({
    key,
    op,
    model,
    response: response as never,
    prompt_version: PROMPT_VERSION,
  })
  // A duplicate key means another worker got there first, which is a race we
  // are happy to lose.
  if (error && !error.message.includes('duplicate')) {
    console.warn(`[ops] cache write failed: ${error.message}`)
  }
}

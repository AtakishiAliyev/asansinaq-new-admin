// The worker's environment, validated once at startup and never read again
// from process.env. Same discipline as src/lib/env.ts, different runtime: no
// VITE_ prefix here, because none of this may ever reach the client bundle.
//
// Every model id is configuration, not a constant. The lane a question takes is
// a decision the code makes; WHICH model serves that lane is a decision a
// golden-set eval settles, and hardcoding one puts that comparison out of reach.
//
// The worker runs on the operator's machine today and on a host later. Nothing
// here may assume either — moving it is meant to be an env-var change.
import { z } from 'zod'

const envSchema = z.object({
  SUPABASE_URL: z.url(),
  /**
   * Bypasses RLS: it reads crops, writes the ledger, and is the only way to
   * call the worker queue RPCs. Never commit it and never expose it to the
   * browser — the anon key is the client's, this one is the worker's alone.
   */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),

  /**
   * Lease identity. Two workers must not share one, or each would renew and
   * release the other's rows — the failure the lease exists to prevent.
   */
  WORKER_ID: z.string().min(1),

  /** Text-only questions. */
  MODEL_TEXT: z.string().min(1),
  /** Questions carrying a figure. */
  MODEL_FIGURE: z.string().min(1),
  /** Render-and-compare verification. */
  MODEL_VERIFY: z.string().min(1),

  /**
   * Mirrors the Edge Function secret of the same name. The server-side check in
   * ops_spend_today() is the one that enforces; this is what the worker reads
   * to stop before submitting rather than after being refused.
   */
  DAILY_BUDGET_USD: z.coerce.number().positive(),

  /** Questions per claim. The Batches API caps a batch far above anything sane here. */
  BATCH_SIZE: z.coerce.number().int().positive().max(50),

  /**
   * At or below this many queued questions, the worker runs SYNCHRONOUSLY.
   *
   * Batch is half price and stays the default for bulk, but its latency does
   * not scale down: a batch of one waits in the provider's queue as long as a
   * batch of fifty, and a measured eight-question run spent 85% of its wall
   * clock waiting across two waves. A set this small is one an operator is
   * watching, and minutes matter more than the discount.
   */
  EXPRESS_THRESHOLD: z.coerce.number().int().nonnegative().default(20),

  /**
   * How many questions express works on at once.
   *
   * Each one holds an Anthropic call and possibly a Gemini call, so this is
   * also the ceiling on concurrent figure generations. Low by default: the
   * point is to remove queue waiting, not to find the provider's rate limit,
   * and a 429 wastes the paid steps a question has already completed.
   */
  EXPRESS_CONCURRENCY: z.coerce.number().int().positive().max(16).default(4),

  /**
   * The figure-reproduction lane. OPTIONAL on purpose.
   *
   * Without these the lane is simply off, and a book set to `figure_render =
   * 'gen'` falls back to its cleaned cut with a flag rather than failing — the
   * lane is an enhancement over something that already works, so a missing key
   * must never be able to stop a queue. It is also the only provider here that
   * is not Anthropic, so it stays opt-in by absence.
   */
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_IMAGE_MODEL: z.string().min(1).optional(),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ')
  throw new Error(
    `Invalid worker environment — ${details}. ` +
      'Load .env first: set -a; . ./.env; set +a',
  )
}

export const config = parsed.data
export type WorkerConfig = typeof config

import { z } from 'zod'

export const budgetStatusSchema = z.object({
  spent: z.coerce.number(),
  budget: z.coerce.number(),
  remaining: z.coerce.number(),
})

export type BudgetStatus = z.infer<typeof budgetStatusSchema>

export const opSummarySchema = z.array(
  z.object({
    op: z.string(),
    calls: z.coerce.number(),
    /** Calls our own ops_cache answered, so no model ran at all. */
    cached: z.coerce.number(),
    /** Prompt tokens across the calls that DID reach a model. */
    prompt_tokens: z.coerce.number(),
    /** Of those, the ones the provider served from its prompt cache. A wholly
     *  different mechanism from `cached` above, and the reason both are here. */
    cache_read_tokens: z.coerce.number(),
    cost: z.coerce.number(),
    ms_p50: z.coerce.number().nullable(),
  }),
)

export type OpSummary = z.infer<typeof opSummarySchema>

export const dailySpendSchema = z.array(
  z.object({
    day: z.string(),
    cost: z.coerce.number(),
    calls: z.coerce.number(),
  }),
)

export type DailySpend = z.infer<typeof dailySpendSchema>

export const opLogRowSchema = z.object({
  id: z.number(),
  op: z.string(),
  model: z.string().nullable(),
  prompt_tokens: z.number().nullable(),
  output_tokens: z.number().nullable(),
  ms: z.number().nullable(),
  est_cost_usd: z.coerce.number().nullable(),
  cached: z.boolean(),
  created_at: z.string(),
})

export type OpLogRow = z.infer<typeof opLogRowSchema>

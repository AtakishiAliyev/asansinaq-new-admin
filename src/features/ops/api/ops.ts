import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { opsKeys } from '@/features/ops/api/keys'
import {
  budgetStatusSchema,
  dailySpendSchema,
  opLogRowSchema,
  opSummarySchema,
  type BudgetStatus,
  type DailySpend,
  type OpLogRow,
  type OpSummary,
} from '@/features/ops/schemas'
import { z } from 'zod'

/**
 * Today's spend against the cap. The cap lives in the Edge Function's secrets
 * — the same value the refusal is decided by — so this reads the number that
 * is actually enforced rather than a copy of it.
 */
export function useBudgetStatus() {
  return useQuery({
    queryKey: opsKeys.budget(),
    queryFn: async (): Promise<BudgetStatus> => {
      const { data, error } = await supabase.functions.invoke('question-ops', {
        body: { op: 'budget_status' },
      })
      if (error) throw error
      return budgetStatusSchema.parse(data)
    },
    // Spend only moves while work runs, and this costs a function invocation.
    refetchInterval: 30_000,
  })
}

export function useOpsSummary() {
  return useQuery({
    queryKey: opsKeys.summary(),
    queryFn: async (): Promise<OpSummary> => {
      const { data, error } = await supabase.rpc('ops_summary_today')
      if (error) throw error
      return opSummarySchema.parse(data)
    },
    refetchInterval: 30_000,
  })
}

export function useDailySpend(days = 14) {
  return useQuery({
    queryKey: opsKeys.daily(days),
    queryFn: async (): Promise<DailySpend> => {
      const { data, error } = await supabase.rpc('ops_spend_daily', {
        p_days: days,
      })
      if (error) throw error
      return dailySpendSchema.parse(data)
    },
  })
}

export function useRecentOps(limit = 50) {
  return useQuery({
    queryKey: opsKeys.recent(limit),
    queryFn: async (): Promise<OpLogRow[]> => {
      const { data, error } = await supabase
        .from('ops_log')
        .select(
          'id, op, model, prompt_tokens, output_tokens, ms, est_cost_usd, cached, created_at',
        )
        .order('created_at', { ascending: false })
        .limit(limit)
      if (error) throw error
      return z.array(opLogRowSchema).parse(data ?? [])
    },
    refetchInterval: 30_000,
  })
}

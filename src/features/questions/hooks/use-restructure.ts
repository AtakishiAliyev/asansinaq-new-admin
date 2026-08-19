import { useCallback } from 'react'
import {
  useStructuringRun,
  type RunOptions,
} from '@/features/questions/hooks/use-structuring-run'
import { toCropEntries } from '@/features/questions/lib/crop-entry'
import type { QuestionRow } from '@/features/questions/schemas'

// Re-running saved rows through the same pipeline the import page uses. The
// op cache makes an unchanged re-run nearly free — only the steps that failed
// (a timed-out image generation) actually bill again.
export function useRestructure() {
  const structuring = useStructuringRun()

  const run = useCallback(
    async (rows: QuestionRow[], options: RunOptions = {}) => {
      const entries = await toCropEntries(rows)
      if (!entries.length) throw new Error('crop faylları açıla bilmədi')
      return structuring.run(entries, options)
    },
    [structuring],
  )

  return { ...structuring, run }
}

import { useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { Crop } from '@/core/segment/types'
import {
  useStructuringRun,
  type CategoryOption,
} from '@/features/questions/hooks/use-structuring-run'
import type { QuestionRow } from '@/features/questions/schemas'

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('crop oxuna bilmədi'))
    reader.readAsDataURL(blob)
  })
}

// Re-running a saved row rebuilds the in-memory Crop from storage, so the
// same pipeline serves both the import page and the review workbench. The
// op cache makes an unchanged re-run nearly free — only the steps that
// failed (a timed-out image generation) actually bill again.
export function useRestructure() {
  const structuring = useStructuringRun()

  const run = useCallback(
    async (rows: QuestionRow[], categories: CategoryOption[] = []) => {
      const entries: { row: QuestionRow; crop: Crop }[] = []
      for (const row of rows) {
        const { data, error } = await supabase.storage
          .from('question-crops')
          .download(row.crop_path)
        if (error || !data) continue
        entries.push({
          row,
          crop: {
            number: row.q_no,
            col: row.col,
            pageNumber: row.page_number,
            dataUrl: await blobToDataUrl(data),
            figureKind: row.figure_kind,
            textLayer: row.text_layer ?? '',
          },
        })
      }
      if (!entries.length) throw new Error('crop faylları açıla bilmədi')
      return structuring.run(entries, categories)
    },
    [structuring],
  )

  return { ...structuring, run }
}

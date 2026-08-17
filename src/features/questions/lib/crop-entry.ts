import { supabase } from '@/lib/supabase'
import type { Crop } from '@/core/segment/types'
import type { QuestionRow } from '@/features/questions/schemas'

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('crop oxuna bilmədi'))
    reader.readAsDataURL(blob)
  })
}

/**
 * Rebuilds the in-memory Crop a saved row came from, so the same pipeline
 * serves the import page, the review workbench and the queue worker. Rows
 * whose crop cannot be downloaded are dropped, not failed: the object may be
 * mid-upload, and marking the question failed would need a second pass to
 * undo.
 */
export async function toCropEntries(
  rows: QuestionRow[],
): Promise<{ row: QuestionRow; crop: Crop }[]> {
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
  return entries
}

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { bandFromBox, type CropBox } from '@/core/segment/manual-band'
import { renderCrops } from '@/core/segment/crop'
import { pageTextItems } from '@/core/segment/segmenter'
import { domCanvas, type PDFDocumentProxy } from '@/features/import'
import { questionKeys } from '@/features/questions/api/keys'
import { dataUrlToBlob } from '@/features/questions/lib/data-url'
import type { QuestionRow } from '@/features/questions/schemas'

// Re-cutting one question from a box a person drew.
//
// This is not the repair path the project removed. That one re-implemented
// the worker in the browser and wrote a row's CONTENT from a second pipeline
// nobody checked against the first. This changes only the INPUT — the
// pixels and the text layer the reader is handed — through the same cutter
// the import uses, and then hands the row back to the worker exactly as a
// fresh crop: the reading is still the worker's, and still the only one.
//
// What it must reset, and why each one is load-bearing:
//
//   * the content (stem, options, figures, flags, verdict) — a new crop is a
//     new question as far as the pipeline is concerned; leaving the old read
//     in place would show the old answer set beside the new picture until
//     the worker got round to it, and the lint flags would describe a read
//     that no longer exists;
//   * `repair_round` and `prev_version` — the worker PARKS the version it is
//     replacing whenever repair_round > 0 and keeps whichever scores better.
//     Re-cut a row that had already spent its repairs and the new read, with
//     the fifth answer restored, would be scored against the old read
//     without it — and could lose;
//   * `reviewed_at` — auto-approve refuses a row a person has ruled on. The
//     person has just ruled that this row starts over.
//
// The bytes go to the row's existing `crop_path`, so every reference — the
// review screen, the worker, the prune script — keeps working. A scan page's
// path ends in `.jpg` and now holds a PNG: the format is sniffed from the
// bytes everywhere it is read, never from the name, and the row's `crop_mime`
// says which it is.

export interface RecropInput {
  row: Pick<
    QuestionRow,
    'id' | 'page_number' | 'col' | 'q_no' | 'crop_path' | 'is_scan' | 'batch_id' | 'claimed_at'
  >
  doc: PDFDocumentProxy
  box: CropBox
}

async function recrop({ row, doc, box }: RecropInput): Promise<void> {
  // Work in flight is already paid for; replacing its input under it would
  // write a result for a picture that no longer exists.
  if (row.batch_id || row.claimed_at)
    throw new Error('Bu sual hazırda emaldadır — bitməsini gözləyin, sonra kəsin')

  const page = await doc.getPage(row.page_number)
  // A scan has no text layer; the band's own hint is then rightly empty.
  const items = row.is_scan ? [] : await pageTextItems(page)
  const band = bandFromBox(items, box, row.q_no, row.col)
  // Never in scan mode, even on a scan: that mode lets the ink regroup the
  // boxes, and this box was measured by a person. The refiner still trims to
  // the ink; the box the row keeps is the one that was drawn.
  const { crops } = await renderCrops(page, [band], domCanvas)
  const crop = crops[0]
  if (!crop) throw new Error('Qutunun içində heç nə yoxdur')

  const { blob, mime } = dataUrlToBlob(crop.dataUrl)
  const { error: uploadError } = await supabase.storage
    .from('question-crops')
    .upload(row.crop_path, blob, { upsert: true, contentType: mime })
  if (uploadError) throw uploadError

  const { error } = await supabase
    .from('questions')
    .update({
      crop_mime: mime,
      crop_box: box as never,
      figure_kind: crop.figureKind,
      text_layer: crop.textLayer || null,
      status: 'cropped',
      stem: null,
      options: null,
      figures: null,
      flags: [],
      model: null,
      extraction_error: null,
      verified: false,
      verify_confidence: null,
      verify_diff: null,
      verified_at: null,
      repair_round: 0,
      prev_version: null,
      auto_approved: false,
      reviewed_at: null,
      reviewed_by: null,
    })
    .eq('id', row.id)
  if (error) throw error

  const { error: queueError } = await supabase.rpc('enqueue_questions', {
    p_ids: [row.id],
  })
  if (queueError) throw queueError
}

export function useRecropQuestion() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: recrop,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: questionKeys.all })
    },
  })
}

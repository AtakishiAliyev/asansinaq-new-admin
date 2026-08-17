import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { normalizeError } from '@/lib/errors'
import type { Crop } from '@/core/segment/types'
import type { PageResult } from '@/features/import/hooks/use-segmentation'
import type { Book } from '@/features/books'
import { questionKeys } from '@/features/questions/api/keys'
import {
  cropKey,
  questionRowSchema,
  rowKey,
  type QuestionRow,
} from '@/features/questions/schemas'

const UPLOAD_CONCURRENCY = 3
const UPSERT_CHUNK = 50
/** PostgREST's default cap — an unbounded select silently stops here. */
const SELECT_PAGE = 1000

interface ExistingRow {
  page_number: number
  col: number
  q_no: number
  status: string
}

// The preserve rule is a correctness guard, so it may never ride on a
// truncated read: a key missing from this result is a key that gets upserted
// back to status='cropped' with stem/options/figures nulled — paid extraction
// and human review destroyed silently. Hence the explicit paging.
async function fetchExistingRows(
  bookId: number,
  pages: number[],
): Promise<ExistingRow[]> {
  const rows: ExistingRow[] = []
  for (let offset = 0; ; offset += SELECT_PAGE) {
    const { data, error } = await supabase
      .from('questions')
      .select('page_number, col, q_no, status')
      .eq('book_id', bookId)
      .in('page_number', pages)
      .order('page_number')
      .order('col')
      .order('q_no')
      .range(offset, offset + SELECT_PAGE - 1)
    if (error) throw error
    const batch = data ?? []
    rows.push(...batch)
    if (batch.length < SELECT_PAGE) return rows
  }
}

function dataUrlToBlob(dataUrl: string): { blob: Blob; mime: string } {
  const m = dataUrl.match(/^data:([^;]+);base64,(.*)$/)
  if (!m) throw new Error('yanlış dataUrl')
  const [, mime, b64] = m
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return { blob: new Blob([bytes], { type: mime }), mime }
}

export function cropStoragePath(bookId: number, crop: Crop, mime: string) {
  const ext = mime === 'image/jpeg' ? 'jpg' : 'png'
  return `${bookId}/p${crop.pageNumber}_c${crop.col}_q${crop.number}.${ext}`
}

export interface SaveCropsInput {
  book: Book
  results: PageResult[]
}

export interface SaveCropsResult {
  /** freshly saved/refreshed rows, joined back to their in-memory crops */
  saved: { row: QuestionRow; crop: Crop; isScan: boolean; testNo?: number }[]
  /** natural keys skipped because the row is already structured/reviewed */
  skippedKeys: string[]
  failed: number
}

// Auto-save after a segmentation run: crops are free, so ALL of them persist
// as status='cropped' rows — the paid structuring step is a separate,
// operator-selected action. Rows already past 'cropped'/'failed' are left
// completely untouched (object not re-uploaded either): refreshing them would
// discard paid extraction or reviewed work.
async function saveCrops({
  book,
  results,
}: SaveCropsInput): Promise<SaveCropsResult> {
  const entries = results.flatMap((page) =>
    page.crops.map((crop) => ({
      crop,
      isScan: page.isScan,
      testNo: page.testNo,
      key: cropKey(crop),
    })),
  )
  if (!entries.length) return { saved: [], skippedKeys: [], failed: 0 }

  const pages = [...new Set(entries.map((e) => e.crop.pageNumber))]
  const existingRows = await fetchExistingRows(book.id, pages)

  const protectedKeys = new Set(
    existingRows
      .filter((r) => !['cropped', 'failed'].includes(r.status))
      .map((r) => rowKey(r)),
  )
  const saveable = entries.filter((e) => !protectedKeys.has(e.key))
  const skippedKeys = entries
    .filter((e) => protectedKeys.has(e.key))
    .map((e) => e.key)

  // Upload crops (deterministic paths → idempotent re-runs).
  let failed = 0
  const uploaded: typeof saveable = []
  let cursor = 0
  await Promise.all(
    Array.from({ length: UPLOAD_CONCURRENCY }, async () => {
      while (cursor < saveable.length) {
        const entry = saveable[cursor++]
        try {
          const { blob, mime } = dataUrlToBlob(entry.crop.dataUrl)
          const path = cropStoragePath(book.id, entry.crop, mime)
          const { error } = await supabase.storage
            .from('question-crops')
            .upload(path, blob, { upsert: true, contentType: mime })
          if (error) throw error
          uploaded.push(entry)
        } catch {
          failed++
        }
      }
    }),
  )

  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id ?? null

  const saved: SaveCropsResult['saved'] = []
  for (let i = 0; i < uploaded.length; i += UPSERT_CHUNK) {
    const chunk = uploaded.slice(i, i + UPSERT_CHUNK)
    const rows = chunk.map((e) => {
      const mime = e.crop.dataUrl.startsWith('data:image/jpeg')
        ? 'image/jpeg'
        : 'image/png'
      return {
        book_id: book.id,
        page_number: e.crop.pageNumber,
        col: e.crop.col,
        q_no: e.crop.number,
        test_no: e.testNo ?? null,
        crop_path: cropStoragePath(book.id, e.crop, mime),
        crop_mime: mime,
        figure_kind: e.crop.figureKind,
        is_scan: e.isScan,
        text_layer: e.crop.textLayer || null,
        status: 'cropped' as const,
        stem: null,
        options: null,
        figures: null,
        model: null,
        flags: [],
        verified: false,
        extraction_error: null,
        created_by: userId,
      }
    })
    const { data, error } = await supabase
      .from('questions')
      .upsert(rows, { onConflict: 'book_id,page_number,col,q_no' })
      .select()
    if (error) {
      failed += chunk.length
      continue
    }
    const parsed = data.map((r) => questionRowSchema.parse(r))
    for (const row of parsed) {
      const entry = chunk.find((e) => e.key === rowKey(row))
      if (entry) {
        saved.push({
          row,
          crop: entry.crop,
          isScan: entry.isScan,
          testNo: entry.testNo,
        })
      }
    }
  }

  return { saved, skippedKeys, failed }
}

export function useSaveCrops() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: saveCrops,
    onSuccess: (result) => {
      // The list/count keys carry the whole filter object, so no narrower key
      // reliably matches the queries a save invalidates.
      queryClient.invalidateQueries({ queryKey: questionKeys.all })
      const parts = [`${result.saved.length} sual bazaya yazıldı`]
      if (result.skippedKeys.length)
        parts.push(`${result.skippedKeys.length} ötürüldü (artıq emal olunub)`)
      if (result.failed) parts.push(`${result.failed} alınmadı`)
      ;(result.failed ? toast.warning : toast.success)(parts.join(', '))
    },
    onError: (error) =>
      toast.error(`Suallar saxlanılmadı: ${normalizeError(error).message}`),
  })
}

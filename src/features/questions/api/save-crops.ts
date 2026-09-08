import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { normalizeError } from '@/lib/errors'
import type { Crop } from '@/core/segment/types'
import type { FigureDoc } from '@/core/figures/figspec'
import type { ExtractedOption, ExtractedQuestion } from '@/core/questions/extraction'
import type { Flag } from '@/core/questions/lint'
import type { PageResult } from '@/features/import/hooks/use-segmentation'
import type { Book } from '@/features/books'
import { questionKeys } from '@/features/questions/api/keys'
import {
  attachFigureImages,
  attachOptionImages,
  loadCrop,
} from '@/features/questions/lib/cut'
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
  id: number
  page_number: number
  col: number
  q_no: number
  status: string
  crop_path: string
  options: unknown
  figures: unknown
  flags: unknown
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
      .select('id, page_number, col, q_no, status, crop_path, options, figures, flags')
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
  // A match always fills both groups — b64 can be empty, never absent.
  const mime = m[1]!
  const b64 = m[2]!
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return { blob: new Blob([bytes], { type: mime }), mime }
}

function cropStoragePath(bookId: number, crop: Crop, mime: string) {
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
  /** natural keys of rows already structured/reviewed: their crop bytes and
   *  cut pictures were refreshed, their content left alone */
  skippedKeys: string[]
  /** how many of those had their crop and cut pictures actually refreshed */
  refreshed: number
  failed: number
}

/** The flags a cut writes. Replaced on a refresh, never duplicated. */
const CUT_FLAG_CODES = new Set([
  'option_boxes_unverified',
  'option_boxes_missing',
  'figure_box_unverified',
])

/**
 * Re-cut a structured row's pictures from a freshly rendered crop.
 *
 * The row's CONTENT is not touched: stem, options text, figures, verdict and
 * review all stand. What changes is the pixels behind them — the crop object
 * is replaced by the new render, and every picture cut from the old crop is
 * cut again from the new one, at the paths the row already points to. The
 * boxes are re-measured against the ink rather than reused as they are,
 * because a re-segmented band can sit a few pixels off the old one.
 *
 * This is how a book imported before crops were rendered larger gets the new
 * resolution without paying to read a single question again.
 */
async function refreshCuts(
  book: Book,
  existing: ExistingRow,
  crop: Crop,
): Promise<void> {
  const { blob, mime } = dataUrlToBlob(crop.dataUrl)
  const { error } = await supabase.storage
    .from('question-crops')
    .upload(existing.crop_path, blob, { upsert: true, contentType: mime })
  if (error) throw error

  const figures = existing.figures as FigureDoc | null
  const options = (Array.isArray(existing.options) ? existing.options : []) as ExtractedOption[]
  const question: ExtractedQuestion = {
    numberSeen: existing.q_no,
    stem: '',
    // Cleared so the cutters treat them as not yet cut. The paths they write
    // are the same deterministic ones the row already carries.
    options: options.map((o) => (o.isImage && o.box && o.image ? { ...o, image: undefined } : o)),
    figures: figures
      ? {
          ...figures,
          items: figures.items.map((item) =>
            item.kind === 'image' && item.box ? { ...item, src: '' } : item,
          ),
        }
      : null,
    illegible: false,
    clipped: false,
    foreign: false,
    confidence: 1,
    warnings: [],
  }
  const hasWork =
    question.options.some((o) => o.isImage && !o.image) ||
    (question.figures?.items ?? []).some((i) => i.kind === 'image' && !i.src)
  if (!hasWork) return

  const rowLike = { book_id: book.id, page_number: crop.pageNumber, col: crop.col, q_no: crop.number }
  const loaded = await loadCrop(crop.dataUrl)
  const cut = await attachOptionImages(rowLike, loaded, question)
  const figureCut = await attachFigureImages(rowLike, loaded, question, 'cut')

  const kept = ((existing.flags ?? []) as Flag[]).filter((f) => !CUT_FLAG_CODES.has(f.code))
  const { error: updateError } = await supabase
    .from('questions')
    .update({
      options: question.options as never,
      figures: question.figures as never,
      flags: [...kept, ...cut.flags, ...figureCut.flags] as never,
    })
    .eq('id', existing.id)
  if (updateError) throw updateError
}

// Auto-save after a segmentation run: crops are free, so ALL of them persist
// as status='cropped' rows — the paid structuring step is a separate,
// operator-selected action. Rows already past 'cropped'/'failed' keep their
// content — refreshing it would discard paid extraction or reviewed work —
// but their crop object and cut pictures are re-rendered, so re-running the
// import over a worked page is how it gets the current crop resolution.
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
  if (!entries.length) return { saved: [], skippedKeys: [], refreshed: 0, failed: 0 }

  const pages = [...new Set(entries.map((e) => e.crop.pageNumber))]
  const existingRows = await fetchExistingRows(book.id, pages)

  const protectedRows = new Map(
    existingRows
      .filter((r) => !['cropped', 'failed'].includes(r.status))
      .map((r) => [rowKey(r), r] as const),
  )
  const saveable = entries.filter((e) => !protectedRows.has(e.key))
  const skippedKeys = entries
    .filter((e) => protectedRows.has(e.key))
    .map((e) => e.key)

  let failed = 0

  // Rows past 'cropped' keep their content and get new PIXELS: the crop object
  // and every picture cut from it are refreshed at the current render scale.
  // Sequential on purpose — each one decodes a full-size crop and cuts from it.
  let refreshed = 0
  for (const entry of entries) {
    const existing = protectedRows.get(entry.key)
    if (!existing) continue
    try {
      await refreshCuts(book, existing, entry.crop)
      refreshed++
    } catch {
      failed++
    }
  }

  // Upload crops (deterministic paths → idempotent re-runs).
  const uploaded: typeof saveable = []
  let cursor = 0
  await Promise.all(
    Array.from({ length: UPLOAD_CONCURRENCY }, async () => {
      while (cursor < saveable.length) {
        const entry = saveable[cursor++]
        if (!entry) continue
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

  return { saved, skippedKeys, refreshed, failed }
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
      if (result.refreshed)
        parts.push(`${result.refreshed} emal olunmuş sualın kəsimi yeniləndi`)
      const untouched = result.skippedKeys.length - result.refreshed
      if (untouched > 0) parts.push(`${untouched} ötürüldü (artıq emal olunub)`)
      if (result.failed) parts.push(`${result.failed} alınmadı`)
      ;(result.failed ? toast.warning : toast.success)(parts.join(', '))
    },
    onError: (error) =>
      toast.error(`Suallar saxlanılmadı: ${normalizeError(error).message}`),
  })
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { normalizeError } from '@/lib/errors'
import { questionKeys } from '@/features/questions/api/keys'
import {
  questionRowSchema,
  type QuestionRow,
} from '@/features/questions/schemas'
import { imagePathsOf, type RowOption } from '@/features/questions/lib/row'
import type { FigureDoc } from '@/core/figures/figspec'
import type { ExtractedQuestion } from '@/core/questions/extraction'
import { LINT_CODES, lintQuestion, type Flag } from '@/core/questions/lint'

const SELECT = '*, books(title)'

export interface QuestionFilters {
  bookId: number | 'all'
  status: QuestionRow['status'] | 'all'
  /** attention = flagged, unverified or failed; clean = verified and flagless */
  queue: 'all' | 'attention' | 'clean'
}

export const DEFAULT_FILTERS: QuestionFilters = {
  bookId: 'all',
  status: 'all',
  queue: 'all',
}

export interface QuestionListItem extends QuestionRow {
  bookTitle: string | null
}

function toItem(row: unknown): QuestionListItem {
  const parsed = questionRowSchema.parse(row)
  const books = (row as { books?: { title?: string } | null }).books
  return { ...parsed, bookTitle: books?.title ?? null }
}

// The lane is a generated column now (20260818123000_needs_attention.sql), so
// the UI reads exactly what the server filtered and counted on — the two can
// no longer disagree about which rows are in the queue.
export function isAttention(q: QuestionListItem): boolean {
  return q.needs_attention
}

/**
 * Lane filter, applied server-side.
 *
 * `needs_attention` is a column the generated `Database` type does not know
 * until the migration is pushed and `npm run types:gen` re-runs, so the cast
 * is confined here — remove it then.
 */
type LaneQuery = { eq: (column: string, value: unknown) => LaneQuery }

function applyLane<T>(query: T, queue: QuestionFilters['queue']): T {
  if (queue === 'all') return query
  const q = query as LaneQuery
  return (
    queue === 'attention'
      ? q.eq('needs_attention', true)
      : q.eq('needs_attention', false).eq('status', 'structured')
  ) as T
}

export const QUESTIONS_PAGE_SIZE = 50

export interface QuestionListPage {
  /** rows of the requested page, after the client-side queue predicate */
  items: QuestionListItem[]
  /** rows the server returned for this page, BEFORE the queue predicate */
  loaded: number
  /** total rows matching the server-side filters (book/status), all pages */
  total: number
  /** zero-based offset of the first row on this page */
  offset: number
}

async function fetchQuestions(
  filters: QuestionFilters,
  page: number,
): Promise<QuestionListPage> {
  const offset = page * QUESTIONS_PAGE_SIZE
  let query = supabase
    .from('questions')
    .select(SELECT, { count: 'exact' })
    .order('book_id')
    .order('page_number')
    .order('col')
    .order('q_no')
    .range(offset, offset + QUESTIONS_PAGE_SIZE - 1)
  if (filters.bookId !== 'all') query = query.eq('book_id', filters.bookId)
  if (filters.status !== 'all') query = query.eq('status', filters.status)
  query = applyLane(query, filters.queue)
  const { data, error, count } = await query
  if (error) throw error
  // Every row the server returns is already in the lane, so a page is a full
  // page of work and `total` is the lane's real size — not the size of the
  // status filter it happened to be a subset of.
  const items = (data ?? []).map(toItem)
  return { items, loaded: items.length, total: count ?? items.length, offset }
}

export function useQuestions(filters: QuestionFilters, page: number) {
  return useQuery({
    queryKey: questionKeys.list(filters, page),
    queryFn: () => fetchQuestions(filters, page),
  })
}

export interface QuestionCounts {
  cropped: number
  structured: number
  approved: number
  rejected: number
  failed: number
  /** rows in the Diqqət lane, whole book — not just the loaded page */
  attention: number
  clean: number
}

const COUNTED_STATUSES = [
  'cropped',
  'structured',
  'approved',
  'rejected',
  'failed',
] as const satisfies readonly (keyof QuestionCounts)[]

// One head-only exact count per bucket: counting rows client-side capped the
// numbers at PostgREST's 1000-row default and quietly under-reported.
async function fetchCounts(bookId: number | 'all'): Promise<QuestionCounts> {
  const scoped = () => {
    const query = supabase
      .from('questions')
      .select('*', { count: 'exact', head: true })
    return bookId === 'all' ? query : query.eq('book_id', bookId)
  }
  const run = async (query: ReturnType<typeof scoped>) => {
    const { count, error } = await query
    if (error) throw error
    return count ?? 0
  }

  const [statuses, attention, clean] = await Promise.all([
    Promise.all(
      COUNTED_STATUSES.map(async (status) => [
        status,
        await run(scoped().eq('status', status)),
      ] as const),
    ),
    run(applyLane(scoped(), 'attention')),
    run(applyLane(scoped(), 'clean')),
  ])

  return {
    ...(Object.fromEntries(statuses) as Pick<
      QuestionCounts,
      (typeof COUNTED_STATUSES)[number]
    >),
    attention,
    clean,
  }
}

export function useQuestionCounts(bookId: number | 'all') {
  return useQuery({
    queryKey: questionKeys.counts(bookId),
    queryFn: () => fetchCounts(bookId),
  })
}


export interface ApproveInput {
  id: number
  categoryId: number
  reviewerDifficulty: number | null
  answer: string | null
  answerChanged: boolean
}

function useQuestionMutation<TInput>(
  mutationFn: (input: TInput) => Promise<void>,
  successMessage: (input: TInput) => string,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: questionKeys.all })
      toast.success(successMessage(input))
    },
    onError: (error) => toast.error(normalizeError(error).message),
  })
}

export function useApproveQuestion() {
  return useQuestionMutation<ApproveInput>(
    async (input) => {
      const { data: userData } = await supabase.auth.getUser()
      const { error } = await supabase
        .from('questions')
        .update({
          status: 'approved',
          category_id: input.categoryId,
          reviewer_difficulty: input.reviewerDifficulty,
          ...(input.answerChanged && input.answer
            ? { answer: input.answer, answer_source: 'reviewer' as const }
            : {}),
          reviewed_by: userData.user?.id ?? null,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', input.id)
      if (error) throw error
    },
    () => 'Sual təsdiqləndi',
  )
}

export function useRejectQuestion() {
  return useQuestionMutation<{ id: number }>(
    async ({ id }) => {
      const { data: userData } = await supabase.auth.getUser()
      const { error } = await supabase
        .from('questions')
        .update({
          status: 'rejected',
          reviewed_by: userData.user?.id ?? null,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', id)
      if (error) throw error
    },
    () => 'Sual rədd edildi',
  )
}

export interface EditInput {
  id: number
  stem: string | null
  options: { label: string; tex?: string; image?: string }[]
}

// A manual edit invalidates the machine verdict: the second read agreed with
// text that no longer exists, so `verified` must go back to false.
export function useEditQuestion() {
  return useQuestionMutation<EditInput>(
    async (input) => {
      const { error } = await supabase
        .from('questions')
        .update({
          stem: input.stem,
          options: input.options,
          verified: false,
        })
        .eq('id', input.id)
      if (error) throw error
    },
    () => 'Dəyişikliklər saxlanıldı',
  )
}

export interface EditFiguresInput {
  id: number
  figures: FigureDoc
  /** The row as it stands, so the lint sees the whole question, not the figure. */
  question: { stem: string | null; options: RowOption[] }
  qNo: number | null
  /** Flags currently on the row, so the ones the lint does not own survive. */
  flags: Flag[]
}

/**
 * Saves an edited figure and re-runs the lint over the result.
 *
 * Three things have to happen together or the row ends up describing a figure
 * that is no longer there.
 *
 * The lint is re-run through the SAME `lintQuestion` the worker uses, because a
 * second copy of the rules in the browser is a copy that drifts — and a
 * reviewer would be fixing flags against rules the pipeline no longer applies.
 * Only the codes the lint owns are replaced; a missing answer or a verification
 * note is not the lint's to clear.
 *
 * The machine verdict is dropped. It was reached against the old figure, so
 * leaving `verified` set would mark a hand-edited row as machine-confirmed —
 * exactly the claim the verification wave exists to make honestly. Clearing
 * `verified_at` also puts the row back in front of the wave, so the next worker
 * run checks the human's fix rather than taking it on trust.
 */
export function useEditFigures() {
  return useQuestionMutation<EditFiguresInput>(
    async (input) => {
      const question: ExtractedQuestion = {
        numberSeen: input.qNo ?? 0,
        stem: input.question.stem ?? '',
        options: input.question.options as unknown as ExtractedQuestion['options'],
        figures: input.figures,
        illegible: false,
        clipped: false,
        foreign: false,
        confidence: 1,
        warnings: [],
      }
      const kept = input.flags.filter((f) => !LINT_CODES.has(f.code))
      const flags = [...kept, ...lintQuestion(question, input.qNo ?? undefined)]

      const { error } = await supabase
        .from('questions')
        .update({
          figures: input.figures as never,
          flags: flags as never,
          verified: false,
          verified_at: null,
          verify_confidence: null,
          verify_diff: null,
        })
        .eq('id', input.id)
      if (error) throw error
    },
    () => 'Fiqur saxlanıldı',
  )
}

export function useBulkApprove() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (inputs: ApproveInput[]) => {
      const { data: userData } = await supabase.auth.getUser()
      const reviewedBy = userData.user?.id ?? null
      const reviewedAt = new Date().toISOString()
      let done = 0
      for (const input of inputs) {
        const { error } = await supabase
          .from('questions')
          .update({
            status: 'approved',
            category_id: input.categoryId,
            reviewer_difficulty: input.reviewerDifficulty,
            reviewed_by: reviewedBy,
            reviewed_at: reviewedAt,
          })
          .eq('id', input.id)
        if (!error) done++
      }
      return { done, total: inputs.length }
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: questionKeys.all })
      const failed = result.total - result.done
      ;(failed ? toast.warning : toast.success)(
        `${result.done} sual təsdiqləndi${failed ? `, ${failed} alınmadı` : ''}`,
      )
    },
    onError: (error) => toast.error(normalizeError(error).message),
  })
}

// Bulk delete: rows first (the operator's intent), objects after. An orphaned
// crop costs pennies; a row that survives a "deleted" toast costs trust.
export function useDeleteQuestions() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (rows: QuestionRow[]) => {
      const ids = rows.map((r) => r.id)
      const { error } = await supabase.from('questions').delete().in('id', ids)
      if (error) throw error
      // Not just the crop: a structured question also owns the figure and
      // option images the run generated, and those have no other referrer.
      const paths = rows.flatMap(imagePathsOf).filter(Boolean)
      for (let i = 0; i < paths.length; i += 100) {
        await supabase.storage.from('question-crops').remove(paths.slice(i, i + 100))
      }
      return ids.length
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: questionKeys.all })
      toast.success(`${count} sual silindi`)
    },
    onError: (error) => toast.error(normalizeError(error).message),
  })
}

export function useDeleteQuestion() {
  return useQuestionMutation<{ id: number; cropPath: string }>(
    async ({ id, cropPath }) => {
      const { error } = await supabase.from('questions').delete().eq('id', id)
      if (error) throw error
      // Best effort: an orphaned object costs pennies, a failed delete that
      // rolls back the row would cost the operator their action.
      await supabase.storage.from('question-crops').remove([cropPath])
    },
    () => 'Sual silindi',
  )
}

/** Signed URLs for crop/figure/option images, batched per render. */
export async function signImageUrls(paths: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))]
  if (!unique.length) return new Map()
  const { data, error } = await supabase.storage
    .from('question-crops')
    .createSignedUrls(unique, 3600)
  if (error) throw error
  const map = new Map<string, string>()
  for (const entry of data ?? []) {
    if (entry.path && entry.signedUrl) map.set(entry.path, entry.signedUrl)
  }
  return map
}

export function useSignedUrls(paths: string[]) {
  const key = [...new Set(paths.filter(Boolean))].sort().join('|')
  return useQuery({
    queryKey: questionKeys.signed(key),
    queryFn: () => signImageUrls(paths),
    enabled: key.length > 0,
    staleTime: 30 * 60_000, // half the signed-URL lifetime
    // Callers sign a sliding window, so the previous map already holds the
    // next item's URLs; keeping it prevents the panes blanking on navigation.
    placeholderData: (previous) => previous,
  })
}

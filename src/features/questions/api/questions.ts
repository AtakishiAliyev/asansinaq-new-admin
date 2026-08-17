import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { normalizeError } from '@/lib/errors'
import { questionKeys } from '@/features/questions/api/keys'
import {
  questionRowSchema,
  type QuestionRow,
} from '@/features/questions/schemas'
import { imagePathsOf } from '@/features/questions/lib/row'

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

// Attention vs clean is a client-side read of flags/verified rather than a
// column: the rule evolves with the pipeline, and a stored copy would drift.
export function isAttention(q: QuestionListItem): boolean {
  if (q.status === 'failed') return true
  if (q.status !== 'structured') return false
  const flags = Array.isArray(q.flags) ? (q.flags as { level?: string }[]) : []
  return !q.verified || flags.some((f) => f.level === 'error' || f.level === 'warning')
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
  const { data, error, count } = await query
  if (error) throw error
  const rows = (data ?? []).map(toItem)
  // The queue predicate reads flags/verified, which no column carries, so it
  // can only run here — over the loaded page, never over the whole table.
  const items =
    filters.queue === 'attention'
      ? rows.filter(isAttention)
      : filters.queue === 'clean'
        ? rows.filter((q) => q.status === 'structured' && !isAttention(q))
        : rows
  return { items, loaded: rows.length, total: count ?? rows.length, offset }
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
}

const COUNTED_STATUSES = [
  'cropped',
  'structured',
  'approved',
  'rejected',
  'failed',
] as const satisfies readonly (keyof QuestionCounts)[]

// One head-only exact count per status: counting rows client-side capped the
// numbers at PostgREST's 1000-row default and quietly under-reported.
async function fetchCounts(bookId: number | 'all'): Promise<QuestionCounts> {
  const counts: QuestionCounts = {
    cropped: 0,
    structured: 0,
    approved: 0,
    rejected: 0,
    failed: 0,
  }
  await Promise.all(
    COUNTED_STATUSES.map(async (status) => {
      let query = supabase
        .from('questions')
        .select('*', { count: 'exact', head: true })
        .eq('status', status)
      if (bookId !== 'all') query = query.eq('book_id', bookId)
      const { count, error } = await query
      if (error) throw error
      counts[status] = count ?? 0
    }),
  )
  return counts
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
  stem: string
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

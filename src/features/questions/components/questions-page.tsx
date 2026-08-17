import { useEffect, useMemo, useState } from 'react'
import { Eye, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyTitle } from '@/components/ui/empty'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { QueryErrorAlert } from '@/components/query-error-alert'
import { cn } from '@/lib/utils'
import { usePageTitle } from '@/hooks/use-page-title'
import { useBooks } from '@/features/books'
import { useCategories } from '@/features/taxonomy'
import {
  DEFAULT_FILTERS,
  isAttention,
  QUESTIONS_PAGE_SIZE,
  useQuestionCounts,
  useQuestions,
  type QuestionFilters,
  type QuestionListItem,
} from '@/features/questions/api/questions'
import { QueuePanel } from '@/features/questions/components/queue-panel'
import { QuestionsSelectionBar } from '@/features/questions/components/questions-selection-bar'
import { QuestionsTable } from '@/features/questions/components/questions-table'
import { ReviewScreen } from '@/features/questions/components/review-screen'
import { useRestructure } from '@/features/questions/hooks/use-restructure'
import { STATUS_LABEL } from '@/features/questions/lib/status'

const STATUS_ORDER = [
  'cropped',
  'structured',
  'approved',
  'rejected',
  'failed',
] as const

const CHIP_ACTIVE: Record<string, string> = {
  all: 'border-foreground/25 bg-foreground/5',
  cropped: 'border-muted-foreground/30 bg-muted',
  structured: 'border-sky-300 bg-sky-50 text-sky-800',
  approved: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  rejected: 'border-muted-foreground/30 bg-muted',
  failed: 'border-destructive/40 bg-destructive/10 text-destructive',
}

export function QuestionsPage() {
  usePageTitle('Suallar')
  const [filters, setFilters] = useState<QuestionFilters>(DEFAULT_FILTERS)
  const [page, setPage] = useState(0)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  // The review cursor is an id, not an index: approving removes the row from a
  // filtered list, and a positional cursor would then skip the next question.
  const [reviewId, setReviewId] = useState<number | null>(null)
  const books = useBooks()
  const questions = useQuestions(filters, page)
  const counts = useQuestionCounts(filters.bookId)
  const restructure = useRestructure()

  const items = useMemo(() => questions.data?.items ?? [], [questions.data])
  const loaded = questions.data?.loaded ?? 0
  const total = questions.data?.total ?? 0
  const offset = questions.data?.offset ?? 0
  const reviewIndex = items.findIndex((q) => q.id === reviewId)
  const selected = items.filter((q) => selectedIds.has(q.id))

  function updateFilters(patch: Partial<QuestionFilters>) {
    setFilters((f) => ({ ...f, ...patch }))
    setPage(0) // a filter change invalidates the offset
    setSelectedIds(new Set()) // selection is per-view; keeping it hides what is acted on
  }

  // Rows leave the filter under us (a bulk approve empties the last page of the
  // «strukturlaşıb» view), and an offset past the end returns nothing at all.
  useEffect(() => {
    if (page > 0 && !questions.isFetching && !questions.isError && loaded === 0) {
      setPage((p) => Math.max(0, p - 1))
    }
  }, [page, loaded, questions.isFetching, questions.isError])

  // Deleted or approved-away rows must not stay selected: the action bar would
  // keep counting questions the list no longer holds.
  useEffect(() => {
    setSelectedIds((current) => {
      if (!current.size) return current
      const visible = new Set(items.map((i) => i.id))
      const next = new Set([...current].filter((id) => visible.has(id)))
      return next.size === current.size ? current : next
    })
  }, [items])

  // Bulk approve only fires for questions that need no human decision: clean,
  // verified, and already carrying an AI category to confirm.
  const bulkReady = items.filter(
    (q) => q.status === 'structured' && !isAttention(q) && q.ai_category_id,
  )
  // The reviewed question's OWN book decides the category tree — with the
  // book filter on "all" a filter-derived subject would be null, leaving the
  // picker empty and every approval blocked.
  const reviewedItem = reviewId
    ? items.find((q) => q.id === reviewId)
    : undefined
  const reviewedBook = reviewedItem
    ? (books.data ?? []).find((b) => b.id === reviewedItem.book_id)
    : undefined
  const currentBook =
    filters.bookId === 'all'
      ? null
      : (books.data ?? []).find((b) => b.id === filters.bookId)
  const reviewSubjectId =
    reviewedBook?.subject_id ?? currentBook?.subject_id ?? null
  const categories = useCategories(reviewSubjectId)
  const categoryOptions = (categories.data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    parentId: c.parent_id,
  }))

  function toggleOne(id: number) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelectedIds((current) =>
      items.every((i) => current.has(i.id))
        ? new Set()
        : new Set(items.map((i) => i.id)),
    )
  }

  function runRestructure(targets: QuestionListItem[]) {
    void restructure
      .run(targets, categoryOptions)
      .then(() => questions.refetch())
      .catch((error) =>
        toast.error(
          error instanceof Error ? error.message : 'yenidən çıxarma alınmadı',
        ),
      )
  }

  const totalCount = counts.data
    ? STATUS_ORDER.reduce((sum, s) => sum + (counts.data[s] ?? 0), 0)
    : null

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <h1 className="text-2xl font-semibold tracking-tight">Suallar</h1>

      <QueuePanel />

      {/* Status is the axis the operator works along, so it is spent as
          always-visible counts rather than hidden behind a dropdown. */}
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={filters.bookId === 'all' ? 'all' : String(filters.bookId)}
          onValueChange={(v) =>
            updateFilters({ bookId: v === 'all' ? 'all' : Number(v) })
          }
        >
          <SelectTrigger className="w-56" aria-label="Kitab süzgəci">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">Bütün kitablar</SelectItem>
              {(books.data ?? []).map((b) => (
                <SelectItem key={b.id} value={String(b.id)}>
                  {b.title}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>

        <div role="group" aria-label="Status süzgəci" className="flex flex-wrap gap-1.5">
          {(['all', ...STATUS_ORDER] as const).map((status) => {
            const count =
              status === 'all' ? totalCount : (counts.data?.[status] ?? null)
            const active = filters.status === status
            return (
              <button
                key={status}
                type="button"
                aria-pressed={active}
                disabled={status !== 'all' && count === 0}
                onClick={() => updateFilters({ status })}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-40',
                  active
                    ? CHIP_ACTIVE[status]
                    : 'text-muted-foreground hover:bg-muted border-transparent',
                )}
              >
                {status === 'all' ? 'Hamısı' : STATUS_LABEL[status]}
                {count === null ? '' : ` ${count}`}
              </button>
            )
          })}
        </div>

        <div
          role="group"
          aria-label="Növbə"
          className="ml-auto flex items-center gap-1"
        >
          {(
            [
              { key: 'all', label: 'Hamısı' },
              { key: 'attention', label: 'Diqqət' },
              { key: 'clean', label: 'Təmiz' },
            ] as const
          ).map((q) => (
            <Button
              key={q.key}
              size="sm"
              variant={filters.queue === q.key ? 'secondary' : 'ghost'}
              aria-pressed={filters.queue === q.key}
              onClick={() => updateFilters({ queue: q.key })}
            >
              {q.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {items.length > 0 ? (
          <Button size="sm" onClick={() => setReviewId(items[0].id)}>
            <Eye data-icon="inline-start" />
            Review başlat
          </Button>
        ) : null}
        {bulkReady.length ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setSelectedIds(new Set(bulkReady.map((q) => q.id)))}
          >
            <Sparkles data-icon="inline-start" />
            Təmizləri seç ({bulkReady.length})
          </Button>
        ) : null}
        {/* The queue rule reads flags/verified, which live in jsonb — it can
            only be applied to the loaded page, so say so instead of implying
            more. */}
        {filters.queue !== 'all' && total > QUESTIONS_PAGE_SIZE ? (
          <p className="text-muted-foreground text-xs">
            «{filters.queue === 'attention' ? 'Diqqət' : 'Təmiz'}» süzgəci
            yalnız bu səhifədəki {loaded} suala tətbiq olunur.
          </p>
        ) : null}
      </div>

      {restructure.status === 'running' ? (
        <div className="flex items-center gap-3">
          <Progress
            value={(restructure.current / Math.max(1, restructure.total)) * 100}
            className="h-2 flex-1"
          />
          <span className="text-muted-foreground shrink-0 text-sm tabular-nums">
            {restructure.current}/{restructure.total} yenidən çıxarılır
          </span>
        </div>
      ) : null}

      {questions.isPending ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : questions.isError ? (
        <QueryErrorAlert
          error={questions.error}
          onRetry={() => questions.refetch()}
          isRetrying={questions.isFetching}
        />
      ) : items.length === 0 ? (
        <Empty>
          <EmptyTitle>Sual yoxdur</EmptyTitle>
          <EmptyDescription>
            {loaded > 0
              ? 'Bu səhifədə süzgəcə uyğun sual yoxdur — növbəti səhifəyə keçin.'
              : 'İmport səhifəsində crop-ları seçib «Çıxarılmaya göndər» ilə bura əlavə edin.'}
          </EmptyDescription>
        </Empty>
      ) : (
        <QuestionsTable
          items={items}
          selected={selectedIds}
          onToggle={toggleOne}
          onToggleAll={toggleAll}
          onOpen={(item) => setReviewId(item.id)}
        />
      )}

      {total > QUESTIONS_PAGE_SIZE ? (
        <div className="flex items-center justify-between gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0 || questions.isFetching}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Əvvəlki
          </Button>
          <span className="text-muted-foreground text-xs tabular-nums">
            {loaded > 0 ? `${offset + 1}–${offset + loaded}` : '0'} / {total}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={offset + loaded >= total || questions.isFetching}
            onClick={() => setPage((p) => p + 1)}
          >
            Növbəti
          </Button>
        </div>
      ) : null}

      <QuestionsSelectionBar
        selected={selected}
        onClear={() => setSelectedIds(new Set())}
      />

      {reviewId !== null ? (
        <ReviewScreen
          items={items}
          index={reviewIndex}
          subjectId={reviewSubjectId}
          onNavigate={setReviewId}
          onClose={() => setReviewId(null)}
          onRestructure={(item) => runRestructure([item])}
        />
      ) : null}
    </div>
  )
}

import { useMemo, useState } from 'react'
import { CheckCheck, Eye, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { QueryErrorAlert } from '@/components/query-error-alert'
import { cn } from '@/lib/utils'
import { usePageTitle } from '@/hooks/use-page-title'
import { useBooks } from '@/features/books'
import { useCategories } from '@/features/taxonomy'
import {
  DEFAULT_FILTERS,
  isAttention,
  useBulkApprove,
  useQuestionCounts,
  useQuestions,
  useTodaySpend,
  type QuestionFilters,
  type QuestionListItem,
} from '@/features/questions/api/questions'
import { ReviewScreen } from '@/features/questions/components/review-screen'
import { useRestructure } from '@/features/questions/hooks/use-restructure'
import { parseFlags } from '@/features/questions/lib/row'

const STATUS_LABEL: Record<string, string> = {
  cropped: 'xam',
  structured: 'strukturlaşıb',
  approved: 'təsdiqli',
  rejected: 'rədd edilib',
  failed: 'alınmadı',
}

const STATUS_CLASS: Record<string, string> = {
  cropped: 'border-muted-foreground/20 bg-muted text-muted-foreground',
  structured: 'border-sky-200 bg-sky-50 text-sky-700',
  approved: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  rejected: 'border-muted-foreground/20 bg-muted text-muted-foreground',
  failed: 'border-destructive/30 bg-destructive/10 text-destructive',
}

export function QuestionsPage() {
  usePageTitle('Suallar')
  const [filters, setFilters] = useState<QuestionFilters>(DEFAULT_FILTERS)
  const [reviewIndex, setReviewIndex] = useState<number | null>(null)
  const books = useBooks()
  const questions = useQuestions(filters)
  const counts = useQuestionCounts(filters.bookId)
  const spend = useTodaySpend()
  const bulkApprove = useBulkApprove()
  const restructure = useRestructure()

  const items = useMemo(() => questions.data ?? [], [questions.data])
  // Bulk approve only fires for questions that need no human decision: clean,
  // verified, and already carrying an AI category to confirm.
  const bulkReady = items.filter(
    (q) => q.status === 'structured' && !isAttention(q) && q.ai_category_id,
  )
  const currentBook =
    filters.bookId === 'all'
      ? null
      : (books.data ?? []).find((b) => b.id === filters.bookId)
  const categories = useCategories(currentBook?.subject_id ?? null)
  const categoryOptions = (categories.data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    parentId: c.parent_id,
  }))

  function openReview(item: QuestionListItem) {
    const index = items.findIndex((q) => q.id === item.id)
    setReviewIndex(index >= 0 ? index : 0)
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Suallar</h1>
        {spend.data ? (
          <Badge variant="outline" className="ml-auto" title="Bugünkü model xərci">
            <Wallet />${spend.data.usd.toFixed(2)} · {spend.data.calls} sorğu
            {spend.data.cachedCalls ? ` (${spend.data.cachedCalls} keşdən)` : ''}
          </Badge>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={filters.bookId === 'all' ? 'all' : String(filters.bookId)}
          onValueChange={(v) =>
            setFilters((f) => ({ ...f, bookId: v === 'all' ? 'all' : Number(v) }))
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

        <Select
          value={filters.status}
          onValueChange={(v) =>
            setFilters((f) => ({ ...f, status: v as QuestionFilters['status'] }))
          }
        >
          <SelectTrigger className="w-44" aria-label="Status süzgəci">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">Bütün statuslar</SelectItem>
              {Object.entries(STATUS_LABEL).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                  {counts.data
                    ? ` (${counts.data[value as keyof typeof counts.data] ?? 0})`
                    : ''}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>

        <div role="group" aria-label="Növbə" className="flex items-center gap-1">
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
              onClick={() => setFilters((f) => ({ ...f, queue: q.key }))}
            >
              {q.label}
            </Button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {bulkReady.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              disabled={bulkApprove.isPending}
              onClick={() =>
                bulkApprove.mutate(
                  bulkReady.map((q) => ({
                    id: q.id,
                    categoryId: q.ai_category_id as number,
                    reviewerDifficulty: q.ai_difficulty,
                    answer: null,
                    answerChanged: false,
                  })),
                )
              }
            >
              <CheckCheck data-icon="inline-start" />
              Təmizləri təsdiqlə ({bulkReady.length})
            </Button>
          ) : null}
          {items.length > 0 ? (
            <Button size="sm" onClick={() => setReviewIndex(0)}>
              <Eye data-icon="inline-start" />
              Review başlat
            </Button>
          ) : null}
        </div>
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
            <Skeleton key={i} className="h-12 w-full" />
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
            İmport səhifəsində crop-ları seçib «Çıxarılmaya göndər» ilə bura
            əlavə edin.
          </EmptyDescription>
        </Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Kitab / yer</TableHead>
              <TableHead>Sual</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Qeydlər</TableHead>
              <TableHead className="text-right">Çətinlik</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((q) => {
              const flags = parseFlags(q.flags)
              return (
                <TableRow
                  key={q.id}
                  className="cursor-pointer"
                  onClick={() => openReview(q)}
                >
                  <TableCell className="max-w-56">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        openReview(q)
                      }}
                      className="block w-full truncate text-left font-medium"
                    >
                      {q.bookTitle ?? '—'}
                    </button>
                    <span className="text-muted-foreground text-xs">
                      s.{q.page_number} · sütun {q.col + 1}
                      {q.test_no ? ` · test ${q.test_no}` : ''}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-72">
                    <span className="block truncate text-sm">
                      №{q.q_no}
                      {q.stem ? ` — ${q.stem.replace(/\$/g, '').slice(0, 60)}` : ''}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn(STATUS_CLASS[q.status])}>
                      {STATUS_LABEL[q.status]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {flags.length ? (
                      <span className="text-muted-foreground text-xs">
                        {flags.length} qeyd
                        {flags.some((f) => f.level === 'error') ? ' (xəta)' : ''}
                      </span>
                    ) : q.verified ? (
                      <span className="text-xs text-emerald-700">təmiz</span>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {q.reviewer_difficulty ?? q.ai_difficulty ?? '—'}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}

      {reviewIndex !== null ? (
        <ReviewScreen
          items={items}
          index={reviewIndex}
          subjectId={currentBook?.subject_id ?? null}
          onIndexChange={setReviewIndex}
          onClose={() => setReviewIndex(null)}
          onRestructure={(item) => {
            void restructure
              .run([item], categoryOptions)
              .then(() => questions.refetch())
              .catch((error) =>
                toast.error(
                  error instanceof Error ? error.message : 'yenidən çıxarma alınmadı',
                ),
              )
          }}
        />
      ) : null}
    </div>
  )
}

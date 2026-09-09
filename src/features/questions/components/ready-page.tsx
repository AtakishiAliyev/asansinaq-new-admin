import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
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
import { usePageTitle } from '@/hooks/use-page-title'
import { useBooks } from '@/features/books'
import { useCategories } from '@/features/taxonomy'
import { categoryLabel } from '@/features/questions/components/category-picker'
import { DIFFICULTY_LABEL, DIFFICULTY_LEVELS } from '@/core/questions/difficulty'
import {
  QUESTIONS_PAGE_SIZE,
  READY_FILTERS,
  useQuestions,
  type QuestionFilters,
} from '@/features/questions/api/questions'
import { QuestionsSelectionBar } from '@/features/questions/components/questions-selection-bar'
import { QuestionsTable } from '@/features/questions/components/questions-table'
import { ReadyViewer } from '@/features/questions/components/ready-viewer'

/** Long enough that a word finishes, short enough to feel like typing. */
const SEARCH_DEBOUNCE_MS = 300

// The finished half of the product: questions a student could be shown.
//
// A catalogue, not a queue. Nothing here is waiting to be acted on, so the
// screen carries no worker panel, no queue counters and no cost — those belong
// to the work the Suallar screen is about. What it carries instead is the
// filters someone browsing a bank actually reaches for: which book, which
// topic, how hard, does it have an answer, and a search over the wording.
export function ReadyPage() {
  usePageTitle('Hazır suallar')
  const [filters, setFilters] = useState<QuestionFilters>(READY_FILTERS)
  // Separate from `filters.search` so every keystroke does not become a query.
  const [searchText, setSearchText] = useState('')
  const [page, setPage] = useState(0)
  const [openId, setOpenId] = useState<number | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  const books = useBooks()
  const questions = useQuestions(filters, page)

  const items = useMemo(() => questions.data?.items ?? [], [questions.data])
  const loaded = questions.data?.loaded ?? 0
  const total = questions.data?.total ?? 0
  const offset = questions.data?.offset ?? 0
  const openIndex = items.findIndex((q) => q.id === openId)
  const selected = items.filter((q) => selectedIds.has(q.id))

  // The topic tree belongs to a subject, and a subject is only known once a
  // book is chosen — so the topic filter appears with the book rather than
  // sitting there empty and unexplained.
  const currentBook =
    filters.bookId === 'all'
      ? null
      : (books.data ?? []).find((b) => b.id === filters.bookId)
  const categories = useCategories(currentBook?.subject_id ?? null)
  // Falls back to the bare id rather than an em dash: a row filed under a topic
  // whose tree is not loaded (another book is selected) still says WHICH topic,
  // and "—" would read as "no topic" for a question that has one.
  const categoryName = (id: number | null): string => {
    if (id === null) return '—'
    return categoryLabel(categories.data ?? [], id) ?? `#${id}`
  }

  // The OPEN question's own book decides its topic tree, not the filter's.
  // With "all books" selected there is no filter subject, so the viewer had no
  // tree at all and showed a bare `#9` where the topic's name belongs — and
  // could not offer to change it, because a picker with an empty list is not a
  // choice. Loading it per open row also means the tree is always the right
  // one when the list spans several books.
  const openItem = openIndex >= 0 ? items[openIndex] : undefined
  const openBook = openItem
    ? (books.data ?? []).find((b) => b.id === openItem.book_id)
    : undefined
  const openCategories = useCategories(openBook?.subject_id ?? null)

  function updateFilters(patch: Partial<QuestionFilters>) {
    setFilters((f) => ({ ...f, ...patch }))
    setPage(0) // a filter change invalidates the offset
    // Selection is per-view: rows the operator can no longer see must not stay
    // in the count on a bar whose one action is a permanent delete.
    setSelectedIds(new Set())
  }

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

  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((f) => (f.search === searchText ? f : { ...f, search: searchText }))
      setPage(0)
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [searchText])

  // Deleted or un-approved rows must not stay selected: the bar would keep
  // counting questions the list no longer holds.
  useEffect(() => {
    setSelectedIds((current) => {
      if (!current.size) return current
      const visible = new Set(items.map((i) => i.id))
      const next = new Set([...current].filter((id) => visible.has(id)))
      return next.size === current.size ? current : next
    })
  }, [items])

  // A page past the end returns nothing at all, and filters shrink the list
  // under us — a delete empties the last page of a narrow filter.
  useEffect(() => {
    if (page > 0 && !questions.isFetching && !questions.isError && loaded === 0) {
      setPage((p) => Math.max(0, p - 1))
    }
  }, [page, loaded, questions.isFetching, questions.isError])

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Hazır suallar</h1>
        <p className="text-muted-foreground text-sm">
          Təsdiqlənmiş, şagird qarşısına çıxa bilən suallar.
          {total > 0 ? ` Cəmi ${total}.` : ''}
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={filters.bookId === 'all' ? 'all' : String(filters.bookId)}
          onValueChange={(v) =>
            // The topic belongs to the old book's tree, so it cannot survive a
            // book change — leaving it would filter on an id from another
            // subject and silently return nothing.
            updateFilters({
              bookId: v === 'all' ? 'all' : Number(v),
              categoryId: 'all',
            })
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

        {currentBook ? (
          <Select
            value={
              filters.categoryId === 'all' ? 'all' : String(filters.categoryId)
            }
            onValueChange={(v) =>
              updateFilters({ categoryId: v === 'all' ? 'all' : Number(v) })
            }
          >
            <SelectTrigger className="w-56" aria-label="Mövzu süzgəci">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">Bütün mövzular</SelectItem>
                {(categories.data ?? []).map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {categoryLabel(categories.data ?? [], c.id) ?? c.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ) : null}

        <Select
          value={
            filters.difficulty === 'all' ? 'all' : String(filters.difficulty)
          }
          onValueChange={(v) =>
            updateFilters({ difficulty: v === 'all' ? 'all' : Number(v) })
          }
        >
          <SelectTrigger className="w-36" aria-label="Çətinlik süzgəci">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">Hər çətinlik</SelectItem>
              {DIFFICULTY_LEVELS.map((d) => (
                <SelectItem key={d} value={String(d)}>
                  {DIFFICULTY_LABEL[d]}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>

        <Select
          value={filters.answer}
          onValueChange={(v) =>
            updateFilters({ answer: v as QuestionFilters['answer'] })
          }
        >
          <SelectTrigger className="w-40" aria-label="Cavab süzgəci">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">Cavabdan asılı olmayaraq</SelectItem>
              <SelectItem value="has">Cavabı var</SelectItem>
              <SelectItem value="missing">Cavabı yoxdur</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>

        <div className="relative ml-auto">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Sual mətnində axtar"
            aria-label="Sual mətnində axtar"
            className="w-60 pl-8"
          />
        </div>
      </div>

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
          <EmptyTitle>Hazır sual yoxdur</EmptyTitle>
          <EmptyDescription>
            {filters.search ||
            filters.categoryId !== 'all' ||
            filters.difficulty !== 'all' ||
            filters.answer !== 'all' ||
            filters.bookId !== 'all'
              ? 'Bu süzgəclərə uyğun təsdiqlənmiş sual yoxdur — süzgəcləri genişləndirin.'
              : 'Suallar səhifəsində sualları təsdiqlədikcə burada görünəcəklər.'}
          </EmptyDescription>
        </Empty>
      ) : (
        <QuestionsTable
          items={items}
          variant="ready"
          offset={offset}
          selection={{
            selected: selectedIds,
            onToggle: toggleOne,
            onToggleAll: toggleAll,
          }}
          categoryName={categoryName}
          onOpen={(item) => setOpenId(item.id)}
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
        variant="ready"
        onClear={() => setSelectedIds(new Set())}
      />

      {openId !== null ? (
        <ReadyViewer
          items={items}
          index={openIndex}
          offset={offset}
          total={total}
          categories={openCategories.data ?? []}
          onNavigate={setOpenId}
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </div>
  )
}

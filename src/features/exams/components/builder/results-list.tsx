import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Link } from 'react-router'
import { Keyboard } from 'lucide-react'
import { QueryErrorAlert } from '@/components/query-error-alert'
import { Spinner } from '@/components/ui/spinner'
import { useQuestionSearch } from '@/features/exams/api/search'
import type { BuilderQuestion, SearchFilters } from '@/features/exams/schemas'
import { ResultRow } from '@/features/exams/components/builder/result-row'
import { useSignedPages } from '@/features/exams/components/builder/use-signed-pages'

// The middle column: the bank, filtered, as a list the admin can move
// through without the mouse.
//
// Virtualised because it has to stay fast at hundreds of thousands of rows:
// only the rows on screen are in the DOM, their heights are measured as they
// render (a question with a figure is three times the height of one
// without), and the next page is fetched as the end comes into view.
//
// Keys, when the list has focus: J / ↓ next, K / ↑ previous, Enter or A to
// add the highlighted question to the section being filled.
export function ResultsList({
  filters,
  total,
  subjectEmpty,
  idsInExam,
  canAdd,
  topicName,
  onAdd,
}: {
  filters: SearchFilters
  total: number | null
  /** The subject has no usable question at all, whatever the filters. */
  subjectEmpty: { subjectName: string } | null
  idsInExam: ReadonlySet<number>
  canAdd: boolean
  topicName: (categoryId: number | null) => string
  onAdd: (q: BuilderQuestion) => boolean
}) {
  const search = useQuestionSearch(filters)
  const pages = useMemo(() => search.data?.pages ?? [], [search.data])
  const rows = useMemo(() => pages.flat(), [pages])
  const signed = useSignedPages(pages)
  const resolve = useCallback((src: string) => signed.get(src) ?? src, [signed])

  const scrollRef = useRef<HTMLDivElement>(null)
  const [focus, setFocus] = useState(0)
  const [lastFilters, setLastFilters] = useState(filters)
  // A new search starts at the top.
  if (lastFilters !== filters) {
    setLastFilters(filters)
    setFocus(0)
  }

  const virtualizer = useVirtualizer({
    count: rows.length + (search.hasNextPage ? 1 : 0),
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 190,
    overscan: 6,
  })
  const items = virtualizer.getVirtualItems()

  const lastIndex = items.at(-1)?.index ?? -1
  useEffect(() => {
    if (
      lastIndex >= rows.length - 1 &&
      search.hasNextPage &&
      !search.isFetchingNextPage
    ) {
      void search.fetchNextPage()
    }
  }, [lastIndex, rows.length, search])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [filters])

  const move = (to: number) => {
    const next = Math.max(0, Math.min(rows.length - 1, to))
    setFocus(next)
    virtualizer.scrollToIndex(next, { align: 'auto' })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return
    if (e.key === 'j' || e.key === 'ArrowDown') {
      e.preventDefault()
      move(focus + 1)
    } else if (e.key === 'k' || e.key === 'ArrowUp') {
      e.preventDefault()
      move(focus - 1)
    } else if (e.key === 'Enter' || e.key === 'a') {
      const q = rows[focus]
      if (q && !idsInExam.has(q.id) && canAdd) {
        e.preventDefault()
        // Adding moves on, so a run of Enters fills a section down the list.
        if (onAdd(q)) move(focus + 1)
      }
    }
  }

  if (search.isError) {
    return (
      <div className="p-4">
        <QueryErrorAlert
          error={search.error}
          onRetry={() => void search.refetch()}
          isRetrying={search.isFetching}
        />
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="text-muted-foreground flex items-center gap-3 border-b px-4 py-2 text-xs">
        <span className="text-foreground font-medium tabular-nums">
          {total === null ? '…' : `${total} sual`}
        </span>
        {search.isFetching && !search.isFetchingNextPage ? (
          <Spinner className="size-3.5" />
        ) : null}
        <span className="ml-auto hidden items-center gap-1.5 lg:inline-flex">
          <Keyboard className="size-3.5" />
          J/K hərəkət · Enter əlavə · / axtarış
        </span>
      </div>

      <div
        ref={scrollRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        aria-label="Sual siyahısı"
        className="focus-visible:ring-ring min-h-0 flex-1 overflow-y-auto outline-none focus-visible:ring-2 focus-visible:ring-inset"
      >
        {search.isPending ? (
          <div className="flex justify-center py-16">
            <Spinner />
          </div>
        ) : rows.length === 0 ? (
          // Two different empties, and they want different actions: a
          // filter that excludes everything is undone here, an empty
          // subject is filled on the import and review screens. Saying
          // "no match for these filters" when no filter is set sends the
          // admin looking for a mistake that is not there.
          subjectEmpty ? (
            <div className="mx-auto flex max-w-md flex-col items-center gap-2 px-6 py-16 text-center text-sm">
              <p className="font-medium">
                Bankda {subjectEmpty.subjectName} fənnindən istifadəyə hazır
                sual yoxdur
              </p>
              <p className="text-muted-foreground">
                Denemeyə yalnız təsdiqlənmiş və cavabı olan suallar düşür.
                Kitabı{' '}
                <Link
                  to="/import"
                  className="text-foreground underline underline-offset-4"
                >
                  İmport
                </Link>{' '}
                səhifəsində işləyin, sonra suallar{' '}
                <Link
                  to="/questions"
                  className="text-foreground underline underline-offset-4"
                >
                  Suallar
                </Link>{' '}
                səhifəsində təsdiqlənəndə burada görünəcək.
              </p>
            </div>
          ) : (
            <p className="text-muted-foreground px-6 py-16 text-center text-sm">
              Bu filtrlərə uyğun sual yoxdur.
            </p>
          )
        ) : (
          <div
            style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
          >
            {items.map((item) => {
              const q = rows[item.index]
              return (
                <div
                  key={item.key}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    transform: `translateY(${item.start}px)`,
                  }}
                >
                  {q ? (
                    <ResultRow
                      question={q}
                      topicName={topicName(q.categoryId)}
                      inExam={idsInExam.has(q.id)}
                      canAdd={canAdd}
                      focused={item.index === focus}
                      resolveImageUrl={resolve}
                      onAdd={(x) => {
                        if (onAdd(x)) setFocus(item.index)
                      }}
                      onFocus={() => setFocus(item.index)}
                    />
                  ) : (
                    <div className="flex justify-center py-6">
                      <Spinner className="size-4" />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

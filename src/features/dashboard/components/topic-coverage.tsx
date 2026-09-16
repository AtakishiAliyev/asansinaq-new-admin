import { useEffect, useMemo, useState } from 'react'
import { BarChart3, LayoutGrid } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { QueryErrorAlert } from '@/components/query-error-alert'
import { cn } from '@/lib/utils'
import { useBooks } from '@/features/books'
import { useCategories } from '@/features/taxonomy'
import {
  subjectTotals,
  topicTotals,
  useAllSubjects,
  useBankByTopic,
  type TopicTotals,
} from '@/features/dashboard/api/bank-by-topic'
import { TopicBarChart } from '@/features/dashboard/components/topic-bar-chart'
import { TopicMap, type TopicRow } from '@/features/dashboard/components/topic-map'

// Where the bank is thick and where it is thin, by subject and topic.
//
// Two views of the same cut, because they answer different questions. The
// MAP shows every topic of a subject as a tile, empty ones dimmed — the
// question it answers is "which topics still have nothing", and a chart that
// drew only the filled ones would hide exactly that. The CHART ranks the
// filled topics against one axis, approved against still-in-pipeline — the
// question it answers is "of what we have, how does it compare". The map is
// the default; the chart is a click away.

function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="bg-muted/40 flex flex-col gap-0.5 rounded-lg px-3 py-2.5">
      <span className="text-muted-foreground font-mono text-[11px] tracking-[0.14em] uppercase">
        {label}
      </span>
      <span className="text-xl font-semibold tabular-nums">
        {value}
        {hint ? <span className="text-muted-foreground ml-1.5 text-sm font-normal">{hint}</span> : null}
      </span>
    </div>
  )
}

type View = 'map' | 'chart'

export function TopicCoverage() {
  const bank = useBankByTopic()
  const subjects = useAllSubjects()
  const books = useBooks()
  const [subjectId, setSubjectId] = useState<number | null>(null)
  const [view, setView] = useState<View>('map')

  const bySubject = useMemo(() => subjectTotals(bank.data ?? []), [bank.data])

  // Open on the subject with the most questions; a subject with none is a
  // chip, not a default.
  useEffect(() => {
    if (subjectId !== null || !subjects.data?.length) return
    const richest = [...bySubject.values()].sort((a, b) => b.total - a.total)[0]
    setSubjectId(richest?.subjectId ?? subjects.data[0]!.id)
  }, [subjectId, subjects.data, bySubject])

  const categories = useCategories(subjectId)
  const byTopic = useMemo(
    () => (subjectId === null ? new Map<number, TopicTotals>() : topicTotals(bank.data ?? [], subjectId)),
    [bank.data, subjectId],
  )
  const booksBySubject = useMemo(() => {
    const m = new Map<number, number>()
    for (const b of books.data ?? []) if (b.subject_id !== null) m.set(b.subject_id, (m.get(b.subject_id) ?? 0) + 1)
    return m
  }, [books.data])

  const topics = useMemo<TopicRow[]>(() => {
    const list = (categories.data ?? []).map((c) => ({ id: c.id, name: c.name, totals: byTopic.get(c.id) }))
    // Filled topics by size; the empty ones keep their catalogue order after.
    return list.sort((a, b) => (b.totals?.total ?? 0) - (a.totals?.total ?? 0))
  }, [categories.data, byTopic])
  const emptyCount = topics.filter((t) => (t.totals?.total ?? 0) === 0).length
  const current = subjectId === null ? undefined : bySubject.get(subjectId)

  const pending = bank.isPending || subjects.isPending
  const error = bank.error ?? subjects.error ?? categories.error

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <CardTitle>Bank fənn və mövzu üzrə</CardTitle>
          <CardDescription>
            Hansı mövzuda neçə sual var, neçə kitabdan gəlib, hansı mövzular hələ boşdur.
          </CardDescription>
        </div>
        <div role="group" aria-label="Görünüş" className="bg-muted flex shrink-0 rounded-md p-0.5">
          {(
            [
              { key: 'map', label: 'Xəritə', icon: LayoutGrid },
              { key: 'chart', label: 'Qrafik', icon: BarChart3 },
            ] as const
          ).map((v) => (
            <Button
              key={v.key}
              size="sm"
              variant={view === v.key ? 'secondary' : 'ghost'}
              aria-pressed={view === v.key}
              className={cn('h-7', view === v.key && 'bg-background shadow-sm')}
              onClick={() => setView(v.key)}
            >
              <v.icon data-icon="inline-start" />
              {v.label}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {error ? (
          <QueryErrorAlert error={error} onRetry={() => void bank.refetch()} isRetrying={bank.isFetching} />
        ) : pending ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-8 w-72" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <>
            <div role="group" aria-label="Fənn" className="flex flex-wrap gap-1.5">
              {(subjects.data ?? []).map((s) => {
                const t = bySubject.get(s.id)
                const active = s.id === subjectId
                return (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setSubjectId(s.id)}
                    className={cn(
                      'rounded-full border px-3 py-1 text-xs transition-colors',
                      active
                        ? 'border-foreground/25 bg-foreground/5'
                        : 'text-muted-foreground hover:bg-muted border-transparent',
                    )}
                  >
                    {s.name}
                    <span className="ml-1.5 tabular-nums opacity-70">{t?.total ?? 0}</span>
                  </button>
                )
              })}
            </div>

            {subjectId !== null ? (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="Kitab" value={booksBySubject.get(subjectId) ?? 0} />
                  <Stat
                    label="Mövzu"
                    value={current?.topicsWithQuestions ?? 0}
                    hint={`/ ${categories.data?.length ?? 0}`}
                  />
                  <Stat label="Sual" value={current?.total ?? 0} />
                  <Stat
                    label="Təsdiqlənmiş"
                    value={current?.approved ?? 0}
                    hint={current?.total ? `${Math.round((100 * current.approved) / current.total)}%` : undefined}
                  />
                </div>

                {topics.length === 0 ? (
                  <p className="text-muted-foreground text-sm">Bu fənndə hələ mövzu yoxdur.</p>
                ) : view === 'map' ? (
                  <TopicMap topics={topics} />
                ) : topics.length === emptyCount ? (
                  <p className="text-muted-foreground text-sm">
                    Bu fənndə hələ sual yoxdur — qrafikdə çəkiləsi bir şey yoxdur.
                  </p>
                ) : (
                  <TopicBarChart topics={topics} emptyCount={emptyCount} />
                )}
              </>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}

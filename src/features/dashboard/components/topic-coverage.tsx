import { useEffect, useMemo, useState } from 'react'
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

// Where the bank is thick and where it is thin, by subject and topic.
//
// The question this answers is the one an operator planning the next import
// asks: which topics have questions, from how many books, and which are still
// empty. So the empty topics are drawn too, dimmed, at the bottom — a chart
// that showed only the filled ones would hide exactly the gaps it is for.
//
// One bar per topic, sorted by size. Each bar is two segments: approved (a
// status, so it wears the status green the approved badge already wears) and
// still in the pipeline (neutral). Numbers are text in text ink beside the
// bar, not painted in the bar's colour, so they read at any width.

function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground font-mono text-[11px] tracking-[0.14em] uppercase">
        {label}
      </span>
      <span className="text-xl font-semibold tabular-nums">
        {value}
        {hint ? <span className="text-muted-foreground ml-1 text-sm font-normal">{hint}</span> : null}
      </span>
    </div>
  )
}

function TopicBar({
  name,
  totals,
  max,
}: {
  name: string
  totals: TopicTotals | undefined
  max: number
}) {
  const total = totals?.total ?? 0
  const approved = totals?.approved ?? 0
  const pending = total - approved
  const width = (n: number) => (max > 0 ? `${(n / max) * 100}%` : '0%')
  const empty = total === 0
  const title = empty
    ? `${name}: sual yoxdur`
    : `${name}: ${total} sual · ${approved} təsdiqlənib · ${pending} hazırlanır · ${totals?.books ?? 0} kitab`
  return (
    <li
      title={title}
      className={cn('grid grid-cols-[minmax(0,14rem)_1fr_auto] items-center gap-3', empty && 'opacity-50')}
    >
      <span className="truncate text-sm">{name}</span>
      <div className="bg-muted/40 relative h-3 rounded-[4px]" aria-hidden>
        {/* Two segments with a 2px surface gap between them, both anchored to
            the baseline; the rounded end belongs to the outermost segment. */}
        {approved > 0 ? (
          <div
            className="absolute inset-y-0 left-0 rounded-l-[4px] bg-emerald-600 dark:bg-emerald-500"
            style={{ width: width(approved), borderTopRightRadius: pending ? 0 : 4, borderBottomRightRadius: pending ? 0 : 4 }}
          />
        ) : null}
        {pending > 0 ? (
          <div
            className="bg-muted-foreground/55 absolute inset-y-0 rounded-r-[4px]"
            style={{
              left: `calc(${width(approved)} + ${approved ? 2 : 0}px)`,
              width: `calc(${width(pending)} - ${approved ? 2 : 0}px)`,
              borderTopLeftRadius: approved ? 0 : 4,
              borderBottomLeftRadius: approved ? 0 : 4,
            }}
          />
        ) : null}
      </div>
      <span className="text-muted-foreground w-28 text-right font-mono text-xs tabular-nums">
        {empty ? '—' : `${total} · ${totals?.books ?? 0} kitab`}
      </span>
    </li>
  )
}

export function TopicCoverage() {
  const bank = useBankByTopic()
  const subjects = useAllSubjects()
  const books = useBooks()
  const [subjectId, setSubjectId] = useState<number | null>(null)

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
    () => (subjectId === null ? new Map() : topicTotals(bank.data ?? [], subjectId)),
    [bank.data, subjectId],
  )
  const booksBySubject = useMemo(() => {
    const m = new Map<number, number>()
    for (const b of books.data ?? []) if (b.subject_id !== null) m.set(b.subject_id, (m.get(b.subject_id) ?? 0) + 1)
    return m
  }, [books.data])

  const topics = useMemo(() => {
    const list = (categories.data ?? []).map((c) => ({ id: c.id, name: c.name, totals: byTopic.get(c.id) as TopicTotals | undefined }))
    // Filled topics by size, then the empty ones in their catalogue order.
    return list.sort((a, b) => (b.totals?.total ?? 0) - (a.totals?.total ?? 0))
  }, [categories.data, byTopic])
  const max = topics[0]?.totals?.total ?? 0
  const current = subjectId === null ? undefined : bySubject.get(subjectId)

  const pending = bank.isPending || subjects.isPending
  const error = bank.error ?? subjects.error ?? categories.error

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bank fənn və mövzu üzrə</CardTitle>
        <CardDescription>
          Hansı mövzuda neçə sual var, neçə kitabdan gəlib, hansı mövzular hələ boşdur.
        </CardDescription>
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
                    <span className="ml-1.5 tabular-nums opacity-70">
                      {t?.total ?? 0}
                    </span>
                  </button>
                )
              })}
            </div>

            {subjectId !== null ? (
              <>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
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
                ) : (
                  <div className="flex flex-col gap-2">
                    <div className="text-muted-foreground flex items-center gap-4 text-xs" aria-label="Şərti işarələr">
                      <span className="flex items-center gap-1.5">
                        <span aria-hidden className="inline-block size-2.5 rounded-[2px] bg-emerald-600 dark:bg-emerald-500" />
                        təsdiqlənmiş
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span aria-hidden className="bg-muted-foreground/55 inline-block size-2.5 rounded-[2px]" />
                        hazırlanır
                      </span>
                    </div>
                    <ul className="flex flex-col gap-1.5">
                      {topics.map((t) => (
                        <TopicBar key={t.id} name={t.name} totals={t.totals} max={max} />
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}

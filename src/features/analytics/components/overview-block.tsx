import { ArrowRight, Flag, TriangleAlert } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { QueryErrorAlert } from '@/components/query-error-alert'
import { useAnalyticsOverview } from '@/features/analytics/api/analytics'
import { Stat } from '@/features/analytics/components/bits'
import { num, pct } from '@/features/analytics/lib/format'

// The learning side of İcmal, under the bank's numbers: how many students
// are sitting, how it is going for them across every context, which topics
// they miss most, and what needs an admin's eye (a key that looks wrong, a
// report a student sent). Everything deeper is a link away.
export function AnalyticsOverview() {
  const overview = useAnalyticsOverview()

  if (overview.isPending) return <Skeleton className="h-56" />
  if (overview.isError) {
    return (
      <QueryErrorAlert
        error={overview.error}
        onRetry={() => overview.refetch()}
        isRetrying={overview.isFetching}
      />
    )
  }
  const o = overview.data

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle>Tələbələr və nəticələr</CardTitle>
          <CardDescription>
            Bütün kontekstlər üzrə — denemeler, sonra mövzu testləri və
            roadmap-lər də bura yazılır.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to="/exams/analytics">
            TR-YÖS analitikası <ArrowRight data-icon="inline-end" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Tələbə"
            value={num(o.students_total)}
            hint={`${num(o.students_active_7d)} son 7 gündə aktiv`}
          />
          <Stat
            label="Cəhd"
            value={num(o.attempts_total)}
            hint={`${num(o.attempts_7d)} son 7 gündə`}
          />
          <Stat
            label="Dəqiqlik"
            value={pct(o.accuracy_pct)}
            hint="cavablanan sualların doğru payı"
          />
          <Stat
            label="Boş buraxma"
            value={pct(o.blank_pct)}
            hint={`${num(o.responses_total)} cavab üzərindən`}
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-2">
            <p className="text-muted-foreground font-mono text-[11px] tracking-[0.14em] uppercase">
              Ən çox səhv olunan mövzular
            </p>
            {o.weak_topics.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Hələ 20 cavabdan çox toplanan mövzu yoxdur.
              </p>
            ) : (
              <ul className="divide-y">
                {o.weak_topics.map((t) => (
                  <li
                    key={t.category_id}
                    className="flex items-center gap-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {t.name}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {t.subject_name} · {num(t.responses)} cavab
                      </span>
                    </div>
                    <span className="text-sm font-semibold text-red-700 tabular-nums">
                      {pct(t.miss_pct)} səhv və ya boş
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-muted-foreground font-mono text-[11px] tracking-[0.14em] uppercase">
              Baxılmalı
            </p>
            <ul className="flex flex-col gap-2">
              <li className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
                <TriangleAlert className="size-4 shrink-0 text-amber-700" />
                <span className="flex-1 text-sm">Şübhəli cavab açarı</span>
                <span className="text-sm font-semibold tabular-nums">
                  {num(o.suspicious_questions)}
                </span>
              </li>
              <li className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
                <Flag className="size-4 shrink-0 text-sky-700" />
                <span className="flex-1 text-sm">Tələbə bildirişi (açıq)</span>
                <span className="text-sm font-semibold tabular-nums">
                  {num(o.open_reports)}
                </span>
              </li>
            </ul>
            <p className="text-muted-foreground text-xs">
              Hər ikisi sualın öz səhifəsində görünür — Hazır suallar → sual.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

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
import { BarList } from '@/features/analytics/components/charts'
import { num, pct } from '@/features/analytics/lib/format'

// The learning side of İcmal, under the bank's numbers: a KPI row (the
// figures ARE the chart), the topics students miss most as bars, and what
// needs an admin's eye. Everything deeper is a link away.
export function AnalyticsOverview() {
  const overview = useAnalyticsOverview()

  if (overview.isPending) return <Skeleton className="h-64" />
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
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            Tələbələr və nəticələr
          </h2>
          <p className="text-muted-foreground text-sm">
            Bütün kontekstlər üzrə — denemeler, sonra mövzu testləri və
            roadmap-lər də bura yazılır.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to="/exams/analytics">
            TR-YÖS analitikası <ArrowRight data-icon="inline-end" />
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Tələbə"
          value={num(o.students_total)}
          hint={`${num(o.students_active_7d)} son 7 gündə aktiv`}
        />
        <Tile
          label="Cəhd"
          value={num(o.attempts_total)}
          hint={`${num(o.attempts_7d)} son 7 gündə`}
        />
        <Tile
          label="Dəqiqlik"
          value={pct(o.accuracy_pct)}
          hint="cavablanan sualların doğru payı"
          tone="ok"
        />
        <Tile
          label="Boş buraxma"
          value={pct(o.blank_pct)}
          hint={`${num(o.responses_total)} cavab üzərindən`}
          tone="muted"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Ən çox səhv olunan mövzular</CardTitle>
            <CardDescription>
              Səhv və ya boş buraxılan cavabların payı; ən azı 20 cavabı olan
              mövzular.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BarList
              ariaLabel="Ən çox səhv olunan mövzular"
              rows={o.weak_topics.map((t) => ({
                key: t.category_id,
                label: t.name,
                value: t.miss_pct,
                hint: `${t.subject_name} · ${num(t.responses)} cavab`,
                tone: 'bad',
              }))}
              max={100}
              unit="%"
              format={(v) => String(Math.round(v))}
              emptyText="Hələ 20 cavabdan çox toplanan mövzu yoxdur."
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Baxılmalı</CardTitle>
            <CardDescription>
              Hər ikisi sualın öz səhifəsində görünür — Hazır suallar → sual.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Link
              to="/ready"
              className="hover:bg-muted flex items-center gap-3 rounded-lg border px-3 py-3 transition-colors"
            >
              <TriangleAlert className="size-4 shrink-0 text-amber-700" />
              <span className="flex-1 text-sm">Şübhəli cavab açarı</span>
              <span className="text-lg font-semibold">
                {num(o.suspicious_questions)}
              </span>
            </Link>
            <Link
              to="/ready"
              className="hover:bg-muted flex items-center gap-3 rounded-lg border px-3 py-3 transition-colors"
            >
              <Flag className="size-4 shrink-0 text-sky-700" />
              <span className="flex-1 text-sm">Tələbə bildirişi (açıq)</span>
              <span className="text-lg font-semibold">
                {num(o.open_reports)}
              </span>
            </Link>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}

function Tile({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string
  hint?: string
  tone?: 'ok' | 'muted'
}) {
  return (
    <Card className="gap-1 py-4">
      <CardContent className="px-4">
        <Stat label={label} value={value} hint={hint} tone={tone} />
      </CardContent>
    </Card>
  )
}

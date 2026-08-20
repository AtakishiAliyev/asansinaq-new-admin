import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
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
import { usePageTitle } from '@/hooks/use-page-title'
import {
  useBudgetStatus,
  useDailySpend,
  useOpsSummary,
  useRecentOps,
} from '@/features/ops/api/ops'
import type { DailySpend, OpSummary } from '@/features/ops/schemas'

const usd = (n: number) =>
  n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(n >= 0.01 ? 3 : 4)}`

const OP_LABEL: Record<string, string> = {
  extract: 'Çıxarma',
  redraw_figure: 'Fiqur çəkilişi',
  compare_figures: 'Fiqur müqayisəsi',
  suggest_category: 'Kateqoriya təklifi',
  parse_answer_key: 'Cavab açarı',
  detect_questions: 'Səhifə aşkarlanması',
  option_boxes: 'Şəkilli variantların yeri',
  agent_step: 'Agent addımı',
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <Card className="gap-1 py-4">
      <CardHeader className="px-4">
        <CardDescription className="font-mono text-[11px] tracking-[0.14em] uppercase">
          {label}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-4">
        <p className="text-2xl font-semibold tracking-tight tabular-nums">
          {value}
        </p>
        {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
      </CardContent>
    </Card>
  )
}

// A bar per day, drawn from the numbers themselves — a chart library for six
// rectangles would cost more than the page it sits on.
function SpendTrend({ days }: { days: DailySpend }) {
  if (!days.length) {
    return (
      <p className="text-muted-foreground text-sm">
        Hələ xərc yoxdur — ilk model çağırışından sonra burada görünəcək.
      </p>
    )
  }
  const peak = Math.max(...days.map((d) => d.cost), 0.0001)
  return (
    <div
      className="flex items-end gap-1.5"
      role="img"
      aria-label="Günlük xərc qrafiki"
    >
      {days.map((d) => (
        <div
          key={d.day}
          className="flex min-w-0 flex-1 flex-col items-center gap-1"
        >
          <span className="text-muted-foreground text-[10px] tabular-nums">
            {d.cost > 0 ? usd(d.cost) : ''}
          </span>
          <div
            className="bg-primary/70 w-full rounded-sm"
            style={{ height: `${Math.max(2, (d.cost / peak) * 72)}px` }}
            title={`${d.day}: ${usd(d.cost)} · ${d.calls} çağırış`}
          />
          <span className="text-muted-foreground text-[10px]">
            {d.day.slice(5)}
          </span>
        </div>
      ))}
    </div>
  )
}

function OpBreakdown({ summary }: { summary: OpSummary }) {
  if (!summary.length) {
    return (
      <p className="text-muted-foreground text-sm">
        Bu gün model çağırışı olmayıb.
      </p>
    )
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Əməliyyat</TableHead>
          <TableHead className="text-right">Çağırış</TableHead>
          <TableHead className="text-right">Keşdən</TableHead>
          <TableHead className="text-right">Median</TableHead>
          <TableHead className="text-right">Xərc</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {summary.map((s) => (
          <TableRow key={s.op}>
            <TableCell>{OP_LABEL[s.op] ?? s.op}</TableCell>
            <TableCell className="text-right tabular-nums">{s.calls}</TableCell>
            <TableCell className="text-right tabular-nums">
              {s.calls ? `${Math.round((s.cached / s.calls) * 100)}%` : '—'}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {s.ms_p50 === null ? '—' : `${(s.ms_p50 / 1000).toFixed(1)}s`}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {usd(s.cost)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function OpsPage() {
  usePageTitle('Xərclər')
  const budget = useBudgetStatus()
  const summary = useOpsSummary()
  const daily = useDailySpend()
  const recent = useRecentOps()

  const todaysCalls = (summary.data ?? []).reduce((n, s) => n + s.calls, 0)
  const todaysCached = (summary.data ?? []).reduce((n, s) => n + s.cached, 0)
  const spent = budget.data?.spent ?? 0
  const cap = budget.data?.budget ?? 0
  const usedPct = cap > 0 ? Math.min(100, (spent / cap) * 100) : 0

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <h1 className="text-2xl font-semibold tracking-tight">Xərclər</h1>

      {budget.isError ? (
        <QueryErrorAlert
          error={budget.error}
          onRetry={() => void budget.refetch()}
          isRetrying={budget.isFetching}
        />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Bugünkü büdcə</CardTitle>
          <CardDescription>
            Limit Edge Function secret-indədir — bu, həqiqətən tətbiq olunan
            rəqəmdir, onun kopyası deyil.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {budget.isPending ? (
            <Skeleton className="h-8 w-full" />
          ) : (
            <>
              <div className="flex items-baseline justify-between">
                <span className="text-2xl font-semibold tabular-nums">
                  {usd(spent)}
                </span>
                <span className="text-muted-foreground text-sm tabular-nums">
                  / {usd(cap)} · qalan {usd(budget.data?.remaining ?? 0)}
                </span>
              </div>
              <Progress value={usedPct} />
              {usedPct >= 100 ? (
                <p className="text-destructive text-sm">
                  Büdcə dolub — yeni model çağırışları rədd edilir. Keşdən gələn
                  cavablar işləməyə davam edir.
                </p>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Bu gün çağırış"
          value={summary.isPending ? '—' : String(todaysCalls)}
        />
        <StatCard
          label="Keş nisbəti"
          value={
            summary.isPending || !todaysCalls
              ? '—'
              : `${Math.round((todaysCached / todaysCalls) * 100)}%`
          }
          hint="keşdən cavablanan çağırışlar — pulsuz"
        />
        <StatCard
          label="Orta sual qiyməti"
          value={
            summary.isPending || !todaysCalls
              ? '—'
              : usd(spent / Math.max(1, todaysCalls))
          }
          hint="çağırış başına"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Son 14 gün</CardTitle>
        </CardHeader>
        <CardContent>
          {daily.isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : daily.isError ? (
            <QueryErrorAlert
              error={daily.error}
              onRetry={() => void daily.refetch()}
              isRetrying={daily.isFetching}
            />
          ) : (
            <SpendTrend days={daily.data ?? []} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bu gün əməliyyatlar üzrə</CardTitle>
        </CardHeader>
        <CardContent>
          {summary.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : summary.isError ? (
            <QueryErrorAlert
              error={summary.error}
              onRetry={() => void summary.refetch()}
              isRetrying={summary.isFetching}
            />
          ) : (
            <OpBreakdown summary={summary.data ?? []} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Son çağırışlar</CardTitle>
        </CardHeader>
        <CardContent>
          {recent.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : recent.isError ? (
            <QueryErrorAlert
              error={recent.error}
              onRetry={() => void recent.refetch()}
              isRetrying={recent.isFetching}
            />
          ) : !(recent.data ?? []).length ? (
            <p className="text-muted-foreground text-sm">
              Hələ çağırış yoxdur.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vaxt</TableHead>
                  <TableHead>Əməliyyat</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead className="text-right">Müddət</TableHead>
                  <TableHead className="text-right">Xərc</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(recent.data ?? []).map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="tabular-nums">
                      {new Date(row.created_at).toLocaleTimeString('az-AZ', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </TableCell>
                    <TableCell>
                      {OP_LABEL[row.op] ?? row.op}
                      {row.cached ? (
                        <span className="text-muted-foreground"> · keş</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">
                      {row.model ?? '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.ms === null ? '—' : `${(row.ms / 1000).toFixed(1)}s`}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.est_cost_usd === null ? '—' : usd(row.est_cost_usd)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

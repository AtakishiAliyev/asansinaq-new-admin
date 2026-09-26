import { ArrowLeft } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
import { difficultyLabel } from '@/core/questions/difficulty'
import { cn } from '@/lib/utils'
import {
  useDenemeAnalytics,
  useDenemeler,
} from '@/features/analytics/api/analytics'
import type { DenemeItem } from '@/features/analytics/schemas'
import {
  ChoiceBars,
  ShareBar,
  Stat,
  SuspiciousBadge,
} from '@/features/analytics/components/bits'
import { num, pct, seconds } from '@/features/analytics/lib/format'

// One deneme in depth: how its sittings went (the score distribution), how
// each section went, and then the exam's own view of every question — in
// THIS deneme only, with the number the student saw. The same question's
// life across every context is on the question's page in Hazır suallar.
export function DenemeAnalyticsPage() {
  const { examId } = useParams()
  const id = Number(examId)
  const list = useDenemeler()
  const meta = (list.data ?? []).find((d) => d.exam_id === id)
  usePageTitle(meta ? `${meta.title} · analitika` : 'Deneme analitikası')
  const d = useDenemeAnalytics(Number.isInteger(id) ? id : 0)

  if (d.isPending) return <Skeleton className="h-96" />
  if (d.isError) {
    return (
      <QueryErrorAlert
        error={d.error}
        onRetry={() => d.refetch()}
        isRetrying={d.isFetching}
      />
    )
  }
  const a = d.data
  const maxBin = Math.max(1, ...a.histogram.map((h) => h.n))

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Button variant="ghost" size="sm" className="-ml-2 w-fit" asChild>
            <Link to="/exams/analytics">
              <ArrowLeft data-icon="inline-start" /> TR-YÖS analitikası
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">
            {meta?.title ?? `Deneme #${id}`}
          </h1>
          <p className="text-muted-foreground text-sm">
            {meta
              ? `${meta.kind ?? ''} · ${meta.question_count} sual · maks. ${num(meta.max_score, 1)} bal`
              : ''}
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to={`/exams/${id}`}>Denemeyə keç</Link>
        </Button>
      </header>

      {a.attempts === 0 ? (
        <p className="text-muted-foreground text-sm">
          Bu deneme hələ təhvil verilməyib.
        </p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Stat
              label="Cəhd"
              value={num(a.attempts)}
              hint={`${num(a.students)} tələbə`}
            />
            <Stat
              label="Orta bal"
              value={num(a.avg_score, 1)}
              hint={`median ${num(a.median_score, 1)} · ${pct(a.avg_pct)}`}
            />
            <Stat label="Orta vaxt" value={seconds(a.avg_time_seconds)} />
            <Stat
              label="Vaxt bitdi"
              value={pct(a.timeout_pct)}
              tone={a.timeout_pct && a.timeout_pct > 30 ? 'bad' : undefined}
            />
            <Stat label="Təkrar cəhd" value={pct(a.retake_pct)} />
            <Stat
              label="Açara baxıb"
              value={pct(a.reviewed_pct)}
              hint="review açılıb"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Bal paylanması</CardTitle>
                <CardDescription>
                  Maksimumun faizi ilə, on dilimdə.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div
                  className="flex h-36 items-end gap-1"
                  aria-label="Bal paylanması"
                >
                  {a.histogram.map((h) => (
                    <div
                      key={h.bin}
                      className="flex flex-1 flex-col items-center gap-1"
                      title={`${h.bin * 10}–${h.bin * 10 + 10}%: ${h.n} cəhd`}
                    >
                      <span className="text-muted-foreground text-[10px] tabular-nums">
                        {h.n || ''}
                      </span>
                      <div className="bg-muted flex h-24 w-full items-end overflow-hidden rounded-sm">
                        <span
                          className="w-full bg-primary/80"
                          style={{ height: `${(h.n / maxBin) * 100}%` }}
                        />
                      </div>
                      <span className="text-muted-foreground text-[10px] tabular-nums">
                        {h.bin * 10}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Bölmələr</CardTitle>
                <CardDescription>
                  Bir cəhdə düşən orta doğru / səhv / boş və bal.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead className="text-muted-foreground text-xs">
                    <tr>
                      <th className="pb-1 text-left font-medium">Bölmə</th>
                      <th className="pb-1 text-right font-medium">Doğru</th>
                      <th className="pb-1 text-right font-medium">Səhv</th>
                      <th className="pb-1 text-right font-medium">Boş</th>
                      <th className="pb-1 text-right font-medium">Net</th>
                      <th className="pb-1 text-right font-medium">Bal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.sections.map((s) => (
                      <tr key={s.position} className="border-t">
                        <td className="py-1.5 font-medium">{s.subject_name}</td>
                        <td className="py-1.5 text-right text-emerald-700 tabular-nums">
                          {num(s.avg_correct, 1)}
                        </td>
                        <td className="py-1.5 text-right text-red-700 tabular-nums">
                          {num(s.avg_wrong, 1)}
                        </td>
                        <td className="text-muted-foreground py-1.5 text-right tabular-nums">
                          {num(s.avg_blank, 1)}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">
                          {num(s.avg_net, 2)}
                        </td>
                        <td className="py-1.5 text-right font-medium tabular-nums">
                          {num(s.avg_points, 1)}
                          <span className="text-muted-foreground font-normal">
                            {' '}
                            / {num(s.max_points, 1)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {a.by_day.length > 1 ? (
                  <p className="text-muted-foreground mt-4 text-xs">
                    {a.by_day.length} gündə işlənib:{' '}
                    {a.by_day
                      .map(
                        (b) =>
                          `${new Date(b.day).toLocaleDateString('az-AZ', { day: 'numeric', month: 'short' })} (${b.n})`,
                      )
                      .join(', ')}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          </div>

          <Card className="py-0">
            <CardHeader className="pt-6">
              <CardTitle>Suallar</CardTitle>
              <CardDescription>
                Bu denemedəki sıra ilə. Ayırd etmə — güclü cəhdlərin doğru payı
                minus zəiflərin (0.3-dən yuxarı yaxşıdır, sıfıra yaxın sual heç
                kimi fərqləndirmir).
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12 pl-4 text-right">#</TableHead>
                    <TableHead>Mövzu</TableHead>
                    <TableHead className="w-44">Doğru / səhv / boş</TableHead>
                    <TableHead className="text-right">Doğru</TableHead>
                    <TableHead className="text-right">Boş</TableHead>
                    <TableHead>Cavablar</TableHead>
                    <TableHead className="text-right">Vaxt</TableHead>
                    <TableHead className="text-right">Lövhə</TableHead>
                    <TableHead className="text-right">Dəyişmə</TableHead>
                    <TableHead className="text-right">Ayırd etmə</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {a.items.map((it) => (
                    <ItemRow key={it.seq} it={it} />
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

function ItemRow({ it }: { it: DenemeItem }) {
  return (
    <TableRow>
      <TableCell className="text-muted-foreground pl-4 text-right tabular-nums">
        {it.seq}
      </TableCell>
      <TableCell>
        <span className="block text-sm">{it.category_name ?? '—'}</span>
        <span className="text-muted-foreground text-xs">
          {difficultyLabel(it.difficulty)} · açar {it.answer}
        </span>
      </TableCell>
      <TableCell>
        <ShareBar
          compact
          correct={it.correct_pct}
          wrong={it.wrong_pct}
          blank={it.blank_pct}
        />
      </TableCell>
      <TableCell
        className={cn(
          'text-right tabular-nums',
          it.correct_pct < 25 ? 'text-red-700' : 'text-emerald-700',
        )}
      >
        {pct(it.correct_pct)}
      </TableCell>
      <TableCell className="text-muted-foreground text-right tabular-nums">
        {pct(it.blank_pct)}
      </TableCell>
      <TableCell>
        <ChoiceBars choices={it.choices} answer={it.answer} />
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {seconds(it.avg_time)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {pct(it.board_pct)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {it.avg_changes.toFixed(1)}
      </TableCell>
      <TableCell
        className={cn(
          'text-right tabular-nums',
          it.discrimination !== null &&
            it.discrimination < 0.2 &&
            'text-red-700',
        )}
      >
        {it.discrimination === null ? '—' : it.discrimination.toFixed(2)}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {it.suspicious ? <SuspiciousBadge /> : null}
          {it.open_reports ? (
            <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-800">
              {it.open_reports} bildiriş
            </span>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  )
}

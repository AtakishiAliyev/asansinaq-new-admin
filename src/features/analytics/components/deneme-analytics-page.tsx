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
  Columns,
  ShareBars,
  TipRow,
} from '@/features/analytics/components/charts'
import {
  ChoiceBars,
  ShareBar,
  Stat,
  SuspiciousBadge,
} from '@/features/analytics/components/bits'
import { dayLabel, num, pct, seconds } from '@/features/analytics/lib/format'

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
                <Columns
                  ariaLabel="Bal paylanması"
                  height={170}
                  points={a.histogram.map((h) => ({
                    key: h.bin,
                    label: `${h.bin * 10}–${h.bin * 10 + 10}`,
                    value: h.n,
                    tip: (
                      <>
                        <div className="font-medium">
                          {h.bin * 10}–{h.bin * 10 + 10}% bal
                        </div>
                        <TipRow value={num(h.n)} label="cəhd" />
                      </>
                    ),
                  }))}
                />
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
                <ShareBars
                  ariaLabel="Bölmə üzrə orta doğru, səhv və boş payı"
                  labelWidth={120}
                  rows={a.sections.map((sec) => {
                    const total =
                      (sec.avg_correct ?? 0) +
                        (sec.avg_wrong ?? 0) +
                        (sec.avg_blank ?? 0) || 1
                    return {
                      key: sec.position,
                      label: sec.subject_name,
                      correct: (100 * (sec.avg_correct ?? 0)) / total,
                      wrong: (100 * (sec.avg_wrong ?? 0)) / total,
                      blank: (100 * (sec.avg_blank ?? 0)) / total,
                      hint: `orta ${num(sec.avg_points, 1)} / ${num(sec.max_points, 1)} bal · net ${num(sec.avg_net, 2)}`,
                    }
                  })}
                />
                <p className="text-muted-foreground mt-3 text-xs">
                  {a.sections
                    .map(
                      (sec) =>
                        `${sec.subject_name}: ${num(sec.avg_correct, 1)} doğru · ${num(sec.avg_wrong, 1)} səhv · ${num(sec.avg_blank, 1)} boş · ${num(sec.avg_points, 1)} / ${num(sec.max_points, 1)} bal`,
                    )
                    .join('  ·  ')}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Sual üzrə doğru cavab payı</CardTitle>
              <CardDescription>
                Bu denemedəki sıra ilə; qırmızı — dörddə birdən az doğru.
                Sütunun üstünə gəl: mövzu, paylanma, vaxt.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Columns
                ariaLabel="Sual üzrə doğru cavab payı"
                max={100}
                unit="%"
                height={190}
                labelEvery={
                  a.items.length > 40 ? 5 : a.items.length > 20 ? 2 : 1
                }
                points={a.items.map((it) => ({
                  key: it.seq,
                  label: String(it.seq),
                  value: it.correct_pct,
                  tone: it.correct_pct < 25 ? 'bad' : 'ok',
                  tip: (
                    <>
                      <div className="font-medium">
                        Sual {it.seq} · {it.category_name ?? '—'}
                      </div>
                      <TipRow
                        value={`${Math.round(it.correct_pct)}%`}
                        label="doğru"
                        swatch="bg-emerald-600"
                      />
                      <TipRow
                        value={`${Math.round(it.wrong_pct)}%`}
                        label="səhv"
                        swatch="bg-red-600"
                      />
                      <TipRow
                        value={`${Math.round(it.blank_pct)}%`}
                        label="boş"
                        swatch="bg-zinc-400"
                      />
                      <div className="text-muted-foreground mt-0.5">
                        {seconds(it.avg_time)} · açar {it.answer}
                        {it.suspicious ? ' · şübhəli açar' : ''}
                      </div>
                    </>
                  ),
                }))}
              />
            </CardContent>
          </Card>

          {a.by_day.length > 1 ? (
            <Card>
              <CardHeader>
                <CardTitle>Günlər üzrə cəhdlər</CardTitle>
                <CardDescription>Nə vaxt işlənib.</CardDescription>
              </CardHeader>
              <CardContent>
                <Columns
                  ariaLabel="Günlər üzrə cəhd sayı"
                  height={140}
                  points={a.by_day.map((b) => ({
                    key: b.day,
                    label: dayLabel(b.day),
                    value: b.n,
                    tip: (
                      <>
                        <div className="font-medium">
                          {new Date(b.day).toLocaleDateString('az-AZ')}
                        </div>
                        <TipRow value={num(b.n)} label="cəhd" />
                        <TipRow value={pct(b.avg_pct)} label="orta bal" />
                      </>
                    ),
                  }))}
                />
              </CardContent>
            </Card>
          ) : null}

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

import { useState } from 'react'
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
import { cn } from '@/lib/utils'
import {
  useRoadmapAnalytics,
  useRoadmapRows,
} from '@/features/analytics/api/analytics'
import type { RoadmapFunnelNode } from '@/features/analytics/schemas'
import {
  BarList,
  Columns,
  TipRow,
} from '@/features/analytics/components/charts'
import { ChoiceBars, Stat } from '@/features/analytics/components/bits'
import { StudentSheet } from '@/features/analytics/components/student-sheet'
import { dayLabel, num, pct, seconds } from '@/features/analytics/lib/format'

// One road in depth. The question a road answers is not "how did they
// score" but "how far did they get, and where do they stop": so the
// centre of the page is the FUNNEL down the current version's nodes —
// how many started each step, how many finished it, how many left it
// open — with the correct share and the time per step beside it. Then the
// days, the hardest questions on the road (the bank's own view of each
// lives in Hazır suallar), and the students walking it.
const KIND_LABEL: Record<string, string> = {
  topic_test: 'Mövzu testi',
  mixed_test: 'Qarışıq test',
  checkpoint: 'Yoxlama',
}
const STATUS_LABEL: Record<string, string> = {
  draft: 'Qaralama',
  published: 'Dərc olunub',
  archived: 'Arxivdə',
}

export function RoadmapAnalyticsPage() {
  const { roadmapId } = useParams()
  const id = Number(roadmapId)
  const list = useRoadmapRows()
  const meta = (list.data ?? []).find((r) => r.roadmap_id === id)
  usePageTitle(meta ? `${meta.title} · analitika` : 'Yol analitikası')
  const q = useRoadmapAnalytics(Number.isInteger(id) ? id : 0)
  const [student, setStudent] = useState<string | null>(null)

  if (q.isPending) return <Skeleton className="h-96" />
  if (q.isError) {
    return (
      <QueryErrorAlert
        error={q.error}
        onRetry={() => q.refetch()}
        isRetrying={q.isFetching}
      />
    )
  }
  const a = q.data
  const onOlder = a.enrolled - a.on_current_version

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Button variant="ghost" size="sm" className="-ml-2 w-fit" asChild>
            <Link to="/exams/analytics?tab=roadmaps">
              <ArrowLeft data-icon="inline-start" /> Yol xəritələri
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">{a.title}</h1>
          <p className="text-muted-foreground text-sm">
            {[
              meta?.program_name,
              STATUS_LABEL[a.status] ?? a.status,
              a.version_no ? `v${a.version_no}` : null,
              a.stage_count ? `${a.stage_count} mərhələ` : null,
              a.node_count ? `${a.node_count} addım` : null,
              meta ? `${meta.question_count} sual` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to={`/roadmaps/${id}`}>Yola keç</Link>
        </Button>
      </header>

      {a.enrolled === 0 ? (
        <p className="text-muted-foreground text-sm">
          Bu yola hələ heç kim qoşulmayıb.
        </p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Stat
              label="Qoşulan"
              value={num(a.enrolled)}
              hint={`${num(a.active_7d)} son 7 gündə aktiv`}
            />
            <Stat
              label="Tamamlayan"
              value={num(a.completed)}
              hint={pct(a.completion_pct)}
              tone={a.completed > 0 ? 'ok' : undefined}
            />
            <Stat
              label="Orta irəliləyiş"
              value={pct(a.avg_progress_pct)}
              hint="addımların payı"
            />
            <Stat
              label="Orta doğru"
              value={pct(a.avg_correct_pct)}
              hint="bütün cavablar üzrə"
            />
            <Stat
              label="Addım başına vaxt"
              value={seconds(a.avg_node_time_seconds)}
            />
            <Stat
              label="Bitirmə müddəti"
              value={
                a.median_days === null ? '—' : `${num(a.median_days, 1)} gün`
              }
              hint="median, qoşulandan bitirənədək"
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Yol üzrə axın</CardTitle>
              <CardDescription>
                Cari versiyanın addımları sıra ilə: neçə nəfər başlayıb, neçəsi
                bitirib, neçəsi yarımçıq qoyub. Uzunluq — bitirənlərin sayı,
                qoşulanların ({num(a.on_current_version)}) miqyasında.
                {onOlder > 0
                  ? ` ${num(onOlder)} nəfər köhnə versiyadadır və burada sayılmır.`
                  : ''}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <BarList
                ariaLabel="Addım üzrə bitirənlərin sayı"
                max={Math.max(1, a.on_current_version)}
                labelWidth={220}
                rows={a.funnel.map((n) => ({
                  key: n.version_node_id,
                  label: `${n.stage_position}.${n.position} ${n.title}`,
                  value: n.completed,
                  hint: `${num(n.started)} başlayıb · ${num(n.started - n.completed)} yarımçıq · doğru ${pct(n.avg_correct_pct)}`,
                  tone:
                    n.started >= 5 && n.completed / n.started < 0.5
                      ? 'bad'
                      : undefined,
                }))}
              />
              <FunnelTable nodes={a.funnel} enrolled={a.on_current_version} />
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Günlər üzrə</CardTitle>
                <CardDescription>
                  Bir gündə bitirilən addımlar; sütunun üstünə gəl — o gün
                  qoşulan və yolu bitirənlər.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Columns
                  ariaLabel="Günlər üzrə bitirilən addım sayı"
                  height={150}
                  labelEvery={
                    a.by_day.length > 40 ? 7 : a.by_day.length > 14 ? 3 : 1
                  }
                  points={a.by_day.map((d) => ({
                    key: d.day,
                    label: dayLabel(d.day),
                    value: d.nodes_completed,
                    tip: (
                      <>
                        <div className="font-medium">
                          {new Date(d.day).toLocaleDateString('az-AZ')}
                        </div>
                        <TipRow
                          value={num(d.nodes_completed)}
                          label="addım bitirilib"
                        />
                        <TipRow value={num(d.enrolled)} label="yola qoşulub" />
                        <TipRow value={num(d.completed)} label="yolu bitirib" />
                      </>
                    ),
                  }))}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Ən çətin suallar</CardTitle>
                <CardDescription>
                  Bu yolda ən az doğru cavablanan suallar (ən azı 5 cavab).
                  Sualın bütün kontekstlər üzrə rəqəmləri Hazır suallardadır.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {a.hardest.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    Hələ 5 cavabı olan sual yoxdur.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Sual</TableHead>
                        <TableHead>Addım</TableHead>
                        <TableHead className="text-right">Cavab</TableHead>
                        <TableHead className="text-right">Doğru</TableHead>
                        <TableHead className="w-40">Seçimlər</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {a.hardest.map((h) => (
                        <TableRow key={h.question_id}>
                          <TableCell className="whitespace-nowrap">
                            <span className="font-medium">
                              #{h.question_id}
                            </span>
                            {h.category_name ? (
                              <span className="text-muted-foreground">
                                {' '}
                                · {h.category_name}
                              </span>
                            ) : null}
                            {h.open_reports > 0 ? (
                              <span className="ml-1 rounded-full bg-amber-50 px-1.5 text-[11px] text-amber-800">
                                {h.open_reports} şikayət
                              </span>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-muted-foreground max-w-[180px] truncate">
                            {h.stage_position && h.position
                              ? `${h.stage_position}.${h.position} `
                              : ''}
                            {h.node_title ?? '—'}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {num(h.responses)}
                          </TableCell>
                          <TableCell
                            className={cn(
                              'text-right font-medium tabular-nums',
                              h.correct_pct < 25 && 'text-red-600',
                            )}
                          >
                            {pct(h.correct_pct)}
                          </TableCell>
                          <TableCell>
                            <ChoiceBars choices={h.choices} answer={h.answer} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Tələbələr</CardTitle>
              <CardDescription>
                Yolu gəzənlər, ən son aktiv olandan başlayaraq (ilk 50). Sətrə
                bas — tələbənin bütün işi.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tələbə</TableHead>
                    <TableHead className="text-right">Versiya</TableHead>
                    <TableHead className="text-right">İrəliləyiş</TableHead>
                    <TableHead>Cari addım</TableHead>
                    <TableHead>Qoşulub</TableHead>
                    <TableHead>Son aktivlik</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {a.students.map((s) => (
                    <TableRow
                      key={s.user_id}
                      className="cursor-pointer"
                      onClick={() => setStudent(s.user_id)}
                    >
                      <TableCell className="font-medium">
                        {s.full_name || 'Adsız'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        v{s.version_no}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {num(s.done_nodes)} / {num(s.node_count)}
                        {s.completed_at ? (
                          <span className="ml-1 text-emerald-700">✓</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-muted-foreground max-w-[220px] truncate">
                        {s.completed_at
                          ? 'Yol bitib'
                          : (s.current_node_title ?? '—')}
                      </TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {new Date(s.started_at).toLocaleDateString('az-AZ')}
                      </TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {s.last_at
                          ? new Date(s.last_at).toLocaleDateString('az-AZ')
                          : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      <StudentSheet userId={student} onClose={() => setStudent(null)} />
    </div>
  )
}

// The funnel as numbers: every node, with the drop from the node before —
// the share of those who reached the previous step and did not reach
// this one. That is where a road loses people.
function FunnelTable({
  nodes,
  enrolled,
}: {
  nodes: RoadmapFunnelNode[]
  enrolled: number
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Addım</TableHead>
          <TableHead>Növ</TableHead>
          <TableHead className="text-right">Başlayıb</TableHead>
          <TableHead className="text-right">Bitirib</TableHead>
          <TableHead className="text-right">Yarımçıq</TableHead>
          <TableHead className="text-right">Kəsilmə</TableHead>
          <TableHead className="text-right">Orta doğru</TableHead>
          <TableHead className="text-right">Orta vaxt</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {nodes.map((n, i) => {
          const prev = i > 0 ? nodes[i - 1]!.started : enrolled
          const drop = prev > 0 ? (100 * (prev - n.started)) / prev : null
          return (
            <TableRow key={n.version_node_id}>
              <TableCell className="font-medium">
                <span className="text-muted-foreground tabular-nums">
                  {n.stage_position}.{n.position}
                </span>{' '}
                {n.title}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {KIND_LABEL[n.kind] ?? n.kind} · {n.question_count} sual
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {num(n.started)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {num(n.completed)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {num(n.started - n.completed)}
              </TableCell>
              <TableCell
                className={cn(
                  'text-right tabular-nums',
                  drop !== null && drop >= 30 && prev >= 5 && 'text-red-600',
                )}
              >
                {drop === null ? '—' : pct(drop)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {pct(n.avg_correct_pct)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {seconds(n.avg_time_seconds)}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

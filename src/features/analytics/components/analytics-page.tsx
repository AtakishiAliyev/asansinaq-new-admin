import { useMemo, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
  ATTEMPTS_PAGE_SIZE,
  useAttemptRows,
  useDenemeler,
  useRoadmapRows,
  useTopicAnalytics,
} from '@/features/analytics/api/analytics'
import type {
  DenemeRow,
  RoadmapRow,
  TopicRow,
} from '@/features/analytics/schemas'
import { ShareBar, Stat } from '@/features/analytics/components/bits'
import { num, pct, seconds } from '@/features/analytics/lib/format'
import { BarList, ShareBars } from '@/features/analytics/components/charts'
import { StudentSheet } from '@/features/analytics/components/student-sheet'

// The CONTEXTS as a whole — the TR-YÖS denemeler in three views (the
// denemeler side by side, the topics they cover, the sittings one by one
// with the student behind each) and the roadmaps in a fourth (who joined,
// who finished, how far the rest got). The bank's own view of a question
// lives with the question (Hazır suallar); this page is about where a
// question was met, not the item. The tab lives in the URL so a detail
// page can send the reader back to the right one.
type Tab = 'denemeler' | 'topics' | 'attempts' | 'roadmaps'
const TABS: { key: Tab; label: string }[] = [
  { key: 'denemeler', label: 'Denemeler' },
  { key: 'topics', label: 'Mövzular' },
  { key: 'attempts', label: 'Cəhdlər' },
  { key: 'roadmaps', label: 'Yol xəritələri' },
]

export function AnalyticsPage() {
  usePageTitle('Analitika')
  const [params, setParams] = useSearchParams()
  const asked = params.get('tab')
  const tab: Tab = TABS.some((t) => t.key === asked)
    ? (asked as Tab)
    : 'denemeler'
  const setTab = (t: Tab) =>
    setParams(t === 'denemeler' ? {} : { tab: t }, { replace: true })

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Analitika</h1>
        <p className="text-muted-foreground text-sm">
          Denemelər və yol xəritələri haqqında: hansı çox işlənir, hansı
          çətindir, tələbələr harada dayanır. Bir sualın bütün kontekstlər üzrə
          rəqəmləri isə sualın öz səhifəsindədir.
        </p>
      </header>

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Bölmə">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'rounded-full border px-3 py-1 text-sm transition-colors',
              tab === t.key
                ? 'bg-primary text-primary-foreground border-transparent'
                : 'hover:bg-muted',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'denemeler' ? (
        <DenemelerTab />
      ) : tab === 'topics' ? (
        <TopicsTab />
      ) : tab === 'roadmaps' ? (
        <RoadmapsTab />
      ) : (
        <AttemptsTab />
      )}
    </div>
  )
}

// ── denemeler ────────────────────────────────────────────────────────────────
type SortKey =
  | 'seq'
  | 'attempts'
  | 'avg_pct'
  | 'blank_pct'
  | 'avg_time_seconds'
  | 'timeout_pct'

function DenemelerTab() {
  const rows = useDenemeler()
  const [sort, setSort] = useState<SortKey>('seq')
  const sorted = useMemo(() => {
    const list = [...(rows.data ?? [])]
    const dir = sort === 'seq' ? 1 : -1
    return list.sort((a, b) => {
      const av = a[sort] ?? -Infinity
      const bv = b[sort] ?? -Infinity
      return (av - bv) * dir
    })
  }, [rows.data, sort])

  if (rows.isPending) return <Skeleton className="h-64" />
  if (rows.isError) {
    return (
      <QueryErrorAlert
        error={rows.error}
        onRetry={() => rows.refetch()}
        isRetrying={rows.isFetching}
      />
    )
  }
  const sat = (rows.data ?? []).filter((r) => r.attempts > 0)
  const mostWorked = sat.length
    ? sat.reduce((m, r) => (r.attempts > m.attempts ? r : m))
    : null
  const hardest = sat.length
    ? sat.reduce((m, r) => ((r.avg_pct ?? 101) < (m.avg_pct ?? 101) ? r : m))
    : null
  const easiest = sat.length
    ? sat.reduce((m, r) => ((r.avg_pct ?? -1) > (m.avg_pct ?? -1) ? r : m))
    : null
  const totalAttempts = sat.reduce((s, r) => s + r.attempts, 0)

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Highlight
          label="Cəmi cəhd"
          value={num(totalAttempts)}
          hint={`${sat.length} deneme işlənib`}
        />
        <Highlight
          label="Ən çox işlənən"
          value={mostWorked?.title ?? '—'}
          hint={mostWorked ? `${num(mostWorked.attempts)} cəhd` : undefined}
          to={mostWorked?.exam_id}
        />
        <Highlight
          label="Ən çətin"
          value={hardest?.title ?? '—'}
          hint={hardest ? `orta ${pct(hardest.avg_pct)}` : undefined}
          to={hardest?.exam_id}
        />
        <Highlight
          label="Ən asan"
          value={easiest?.title ?? '—'}
          hint={easiest ? `orta ${pct(easiest.avg_pct)}` : undefined}
          to={easiest?.exam_id}
        />
      </div>

      {sat.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Cəhd sayı</CardTitle>
              <CardDescription>
                Deneme üzrə təhvil verilmiş cəhdlər.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <BarList
                ariaLabel="Deneme üzrə cəhd sayı"
                labelWidth={150}
                rows={sat.map((r) => ({
                  key: r.exam_id,
                  label: r.title,
                  value: r.attempts,
                  hint: `${num(r.students)} tələbə`,
                }))}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Orta bal</CardTitle>
              <CardDescription>
                Maksimumun faizi ilə — aşağı olan daha çətindir.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <BarList
                ariaLabel="Deneme üzrə orta bal"
                labelWidth={150}
                max={100}
                unit="%"
                format={(v) => String(Math.round(v))}
                rows={sat.map((r) => ({
                  key: r.exam_id,
                  label: r.title,
                  value: r.avg_pct ?? 0,
                  hint: `orta ${num(r.avg_score, 1)} / ${num(r.max_score, 1)}`,
                }))}
              />
            </CardContent>
          </Card>
        </div>
      ) : null}

      <Card className="py-0">
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <SortHead k="seq" sort={sort} onSort={setSort} className="pl-4">
                  Deneme
                </SortHead>
                <TableHead>Növ</TableHead>
                <SortHead k="attempts" sort={sort} onSort={setSort} right>
                  Cəhd
                </SortHead>
                <TableHead className="text-right">Tələbə</TableHead>
                <SortHead k="avg_pct" sort={sort} onSort={setSort} right>
                  Orta bal
                </SortHead>
                <TableHead className="text-right">Median</TableHead>
                <SortHead k="blank_pct" sort={sort} onSort={setSort} right>
                  Boş
                </SortHead>
                <SortHead
                  k="avg_time_seconds"
                  sort={sort}
                  onSort={setSort}
                  right
                >
                  Orta vaxt
                </SortHead>
                <SortHead k="timeout_pct" sort={sort} onSort={setSort} right>
                  Vaxt bitdi
                </SortHead>
                <TableHead className="text-right">Təkrar</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((r) => (
                <DenemeTableRow key={r.exam_id} r={r} />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

function DenemeTableRow({ r }: { r: DenemeRow }) {
  const none = r.attempts === 0
  return (
    <TableRow className={none ? 'text-muted-foreground' : undefined}>
      <TableCell className="pl-4 font-medium">
        <Link to={`/exams/analytics/${r.exam_id}`} className="hover:underline">
          {r.title}
        </Link>
      </TableCell>
      <TableCell className="text-muted-foreground">
        {r.kind ?? '—'} · {r.question_count}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {num(r.attempts)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {num(r.students)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {none ? (
          '—'
        ) : (
          <>
            {num(r.avg_score, 1)}
            <span className="text-muted-foreground">
              {' '}
              / {num(r.max_score, 1)}
            </span>
            <span className="text-muted-foreground text-xs">
              {' '}
              ({pct(r.avg_pct)})
            </span>
          </>
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {none ? '—' : num(r.median_score, 1)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {none ? '—' : pct(r.blank_pct)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {none ? '—' : seconds(r.avg_time_seconds)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {none ? '—' : pct(r.timeout_pct)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {none ? '—' : pct(r.retake_pct)}
      </TableCell>
      <TableCell>
        <Button
          variant="ghost"
          size="icon-sm"
          asChild
          aria-label="Deneme detalı"
        >
          <Link to={`/exams/analytics/${r.exam_id}`}>
            <ArrowRight />
          </Link>
        </Button>
      </TableCell>
    </TableRow>
  )
}

function SortHead({
  k,
  sort,
  onSort,
  right,
  className,
  children,
}: {
  k: SortKey
  sort: SortKey
  onSort: (k: SortKey) => void
  right?: boolean
  className?: string
  children: React.ReactNode
}) {
  const active = sort === k
  return (
    <TableHead className={cn(right && 'text-right', className)}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={cn(
          'hover:text-foreground',
          active && 'text-foreground font-semibold',
        )}
        aria-sort={active ? 'descending' : undefined}
      >
        {children}
        {active ? ' ↓' : ''}
      </button>
    </TableHead>
  )
}

function Highlight({
  label,
  value,
  hint,
  to,
}: {
  label: string
  value: string
  hint?: string
  to?: number
}) {
  const body = (
    <Card
      className={cn(
        'h-full gap-1 py-4',
        to && 'hover:bg-accent/50 transition-colors',
      )}
    >
      <CardContent className="px-4">
        <Stat label={label} value={value} hint={hint} />
      </CardContent>
    </Card>
  )
  return to ? <Link to={`/exams/analytics/${to}`}>{body}</Link> : body
}

// ── topics ───────────────────────────────────────────────────────────────────
function TopicsTab() {
  const topics = useTopicAnalytics(null)
  const [subject, setSubject] = useState<'all' | number>('all')
  const subjects = useMemo(() => {
    const m = new Map<number, string>()
    for (const t of topics.data ?? []) m.set(t.subject_id, t.subject_name)
    return [...m.entries()]
  }, [topics.data])
  const rows = (topics.data ?? [])
    .filter((t) => subject === 'all' || t.subject_id === subject)
    .sort((a, b) => a.correct_pct - b.correct_pct)

  if (topics.isPending) return <Skeleton className="h-64" />
  if (topics.isError) {
    return (
      <QueryErrorAlert
        error={topics.error}
        onRetry={() => topics.refetch()}
        isRetrying={topics.isFetching}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {subjects.length > 1 ? (
        <Select
          value={subject === 'all' ? 'all' : String(subject)}
          onValueChange={(v) => setSubject(v === 'all' ? 'all' : Number(v))}
        >
          <SelectTrigger className="w-48" aria-label="Fənn">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">Bütün fənlər</SelectItem>
              {subjects.map(([id, name]) => (
                <SelectItem key={id} value={String(id)}>
                  {name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      ) : null}

      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Hələ mövzu üzrə cavab yoxdur.
        </p>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Mövzu üzrə nəticə</CardTitle>
            <CardDescription>
              Zəifdən güclüyə; hər sətir mövzunun bütün cavablarıdır.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ShareBars
              ariaLabel="Mövzu üzrə doğru, səhv və boş payı"
              rows={rows.map((t) => ({
                key: t.category_id,
                label: t.category_name,
                correct: t.correct_pct,
                wrong: t.wrong_pct,
                blank: t.blank_pct,
                hint: `${t.subject_name} · ${num(t.responses)} cavab · ${num(t.questions)} sual`,
              }))}
            />
          </CardContent>
        </Card>
      )}
      {rows.length === 0 ? null : (
        <Card className="py-0">
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Mövzu</TableHead>
                  <TableHead className="text-right">Sual</TableHead>
                  <TableHead className="text-right">Cavab</TableHead>
                  <TableHead className="w-56">Doğru / səhv / boş</TableHead>
                  <TableHead className="text-right">Doğru</TableHead>
                  <TableHead className="text-right">Boş</TableHead>
                  <TableHead className="text-right">Vaxt</TableHead>
                  <TableHead className="text-right">Etiket</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((t) => (
                  <TopicTableRow key={t.category_id} t={t} />
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      <p className="text-muted-foreground text-xs">
        "Etiket" — bankdakı çətinlik (1 asan · 2 orta · 3 çətin) ortalaması.
        Etiketi "asan" olub doğru faizi aşağı olan mövzu, etiketin yenidən
        baxılmalı olduğunu deyir.
      </p>
    </div>
  )
}

function TopicTableRow({ t }: { t: TopicRow }) {
  return (
    <TableRow>
      <TableCell className="pl-4">
        <span className="block font-medium">{t.category_name}</span>
        <span className="text-muted-foreground text-xs">{t.subject_name}</span>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {num(t.questions)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {num(t.responses)}
      </TableCell>
      <TableCell>
        <ShareBar
          compact
          correct={t.correct_pct}
          wrong={t.wrong_pct}
          blank={t.blank_pct}
        />
      </TableCell>
      <TableCell className="text-right text-emerald-700 tabular-nums">
        {pct(t.correct_pct)}
      </TableCell>
      <TableCell className="text-muted-foreground text-right tabular-nums">
        {pct(t.blank_pct)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {seconds(t.avg_time)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {t.avg_difficulty === null ? '—' : t.avg_difficulty.toFixed(1)}
      </TableCell>
    </TableRow>
  )
}

// ── attempts ─────────────────────────────────────────────────────────────────
function AttemptsTab() {
  const denemeler = useDenemeler()
  const [examId, setExamId] = useState<number | null>(null)
  const [page, setPage] = useState(0)
  const [student, setStudent] = useState<string | null>(null)
  const attempts = useAttemptRows(examId, page)

  if (attempts.isPending) return <Skeleton className="h-64" />
  if (attempts.isError) {
    return (
      <QueryErrorAlert
        error={attempts.error}
        onRetry={() => attempts.refetch()}
        isRetrying={attempts.isFetching}
      />
    )
  }
  const { rows, total } = attempts.data

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={examId === null ? 'all' : String(examId)}
          onValueChange={(v) => {
            setExamId(v === 'all' ? null : Number(v))
            setPage(0)
          }}
        >
          <SelectTrigger className="w-56" aria-label="Deneme">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">Bütün denemeler</SelectItem>
              {(denemeler.data ?? []).map((d) => (
                <SelectItem key={d.exam_id} value={String(d.exam_id)}>
                  {d.title}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <span className="text-muted-foreground text-sm tabular-nums">
          {num(total)} cəhd
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Təhvil verilmiş cəhd yoxdur.
        </p>
      ) : (
        <Card className="py-0">
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Tələbə</TableHead>
                  <TableHead>Deneme</TableHead>
                  <TableHead className="text-right">Bal</TableHead>
                  <TableHead className="text-right">D / S / B</TableHead>
                  <TableHead className="text-right">Vaxt</TableHead>
                  <TableHead>Təhvil</TableHead>
                  <TableHead className="text-right">Tarix</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((a) => (
                  <TableRow key={a.attempt_id}>
                    <TableCell className="pl-4">
                      <button
                        type="button"
                        onClick={() => setStudent(a.user_id)}
                        className="font-medium hover:underline"
                      >
                        {a.student_name || 'Tələbə'}
                      </button>
                    </TableCell>
                    <TableCell>
                      {a.exam_title}
                      {a.attempt_no > 1 ? (
                        <span className="text-muted-foreground">
                          {' '}
                          · {a.attempt_no}-ci
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {num(a.score, 2)}
                      <span className="text-muted-foreground font-normal">
                        {' '}
                        / {num(a.max_score, 1)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className="text-emerald-700">
                        {a.correct_count ?? 0}
                      </span>{' '}
                      /{' '}
                      <span className="text-red-700">{a.wrong_count ?? 0}</span>{' '}
                      /{' '}
                      <span className="text-muted-foreground">
                        {a.blank_count ?? 0}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {seconds(a.time_used_seconds)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {a.submitted_by === 'timeout' ? 'vaxt bitdi' : 'tələbə'}
                      {a.reviewed ? ' · açar görülüb' : ''}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-right text-xs tabular-nums">
                      {a.submitted_at
                        ? new Date(a.submitted_at).toLocaleString('az-AZ', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })
                        : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {total > ATTEMPTS_PAGE_SIZE ? (
        <div className="flex items-center justify-between gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            Əvvəlki
          </Button>
          <span className="text-muted-foreground text-xs tabular-nums">
            {page * ATTEMPTS_PAGE_SIZE + 1}–
            {Math.min(total, (page + 1) * ATTEMPTS_PAGE_SIZE)} / {total}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={(page + 1) * ATTEMPTS_PAGE_SIZE >= total}
            onClick={() => setPage((p) => p + 1)}
          >
            Növbəti
          </Button>
        </div>
      ) : null}

      <StudentSheet userId={student} onClose={() => setStudent(null)} />
    </div>
  )
}

// ── roadmaps ─────────────────────────────────────────────────────────────────
// One row per published road. The number that matters here is not a score
// but how many of those who joined got to the end, and how far the rest
// got; the road's own page has the funnel that says where they stop.
function RoadmapsTab() {
  const rows = useRoadmapRows()
  if (rows.isPending) return <Skeleton className="h-64" />
  if (rows.isError) {
    return (
      <QueryErrorAlert
        error={rows.error}
        onRetry={() => rows.refetch()}
        isRetrying={rows.isFetching}
      />
    )
  }
  const list = rows.data ?? []
  const joined = list.filter((r) => r.enrolled > 0)
  const totalEnrolled = joined.reduce((s, r) => s + r.enrolled, 0)
  const most = joined.length
    ? joined.reduce((m, r) => (r.enrolled > m.enrolled ? r : m))
    : null
  const bestFinish = joined.filter((r) => r.completion_pct !== null)
  const best = bestFinish.length
    ? bestFinish.reduce((m, r) =>
        (r.completion_pct ?? -1) > (m.completion_pct ?? -1) ? r : m,
      )
    : null
  const hardestRows = joined.filter((r) => r.avg_correct_pct !== null)
  const hardest = hardestRows.length
    ? hardestRows.reduce((m, r) =>
        (r.avg_correct_pct ?? 101) < (m.avg_correct_pct ?? 101) ? r : m,
      )
    : null

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <RoadmapHighlight
          label="Qoşulan, cəmi"
          value={num(totalEnrolled)}
          hint={`${joined.length} yol gəzilir`}
        />
        <RoadmapHighlight
          label="Ən çox qoşulan"
          value={most?.title ?? '—'}
          hint={most ? `${num(most.enrolled)} tələbə` : undefined}
          to={most?.roadmap_id}
        />
        <RoadmapHighlight
          label="Ən çox bitirilən"
          value={best?.title ?? '—'}
          hint={best ? `tamamlama ${pct(best.completion_pct)}` : undefined}
          to={best?.roadmap_id}
        />
        <RoadmapHighlight
          label="Ən çətin"
          value={hardest?.title ?? '—'}
          hint={
            hardest ? `orta doğru ${pct(hardest.avg_correct_pct)}` : undefined
          }
          to={hardest?.roadmap_id}
        />
      </div>

      {list.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Hələ dərc olunmuş yol xəritəsi yoxdur.
        </p>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Yol xəritələri</CardTitle>
            <CardDescription>
              Dərc olunmuş hər yol; sətrə bas — addım-addım axın.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Yol</TableHead>
                  <TableHead>Proqram</TableHead>
                  <TableHead className="text-right">Addım</TableHead>
                  <TableHead className="text-right">Qoşulan</TableHead>
                  <TableHead className="text-right">Tamamlayan</TableHead>
                  <TableHead className="text-right">Orta irəliləyiş</TableHead>
                  <TableHead className="text-right">Orta doğru</TableHead>
                  <TableHead className="text-right">7 gündə aktiv</TableHead>
                  <TableHead>Son aktivlik</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((r: RoadmapRow) => (
                  <TableRow key={r.roadmap_id} className="cursor-pointer">
                    <TableCell className="font-medium">
                      <Link
                        to={`/roadmaps/analytics/${r.roadmap_id}`}
                        className="hover:underline"
                      >
                        {r.title}
                      </Link>
                      {r.status === 'archived' ? (
                        <span className="text-muted-foreground">
                          {' '}
                          · arxivdə
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.program_name}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {num(r.node_count)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {num(r.enrolled)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {num(r.completed)}
                      {r.completion_pct !== null ? (
                        <span className="text-muted-foreground">
                          {' '}
                          · {pct(r.completion_pct)}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {pct(r.avg_progress_pct)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {pct(r.avg_correct_pct)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {num(r.active_7d)}
                    </TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {r.last_activity_at
                        ? new Date(r.last_activity_at).toLocaleDateString(
                            'az-AZ',
                          )
                        : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function RoadmapHighlight({
  label,
  value,
  hint,
  to,
}: {
  label: string
  value: string
  hint?: string
  to?: number
}) {
  const body = (
    <Card
      className={cn(
        'h-full gap-1 py-4',
        to && 'hover:bg-accent/50 transition-colors',
      )}
    >
      <CardContent className="px-4">
        <Stat label={label} value={value} hint={hint} />
      </CardContent>
    </Card>
  )
  return to ? (
    <Link to={`/roadmaps/analytics/${to}`} className="block">
      {body}
    </Link>
  ) : (
    body
  )
}

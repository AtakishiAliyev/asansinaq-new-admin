import { Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { QueryErrorAlert } from '@/components/query-error-alert'
import {
  useQuestionAnalytics,
  useResolveReport,
} from '@/features/analytics/api/analytics'
import {
  ChoiceBars,
  ShareBar,
  Stat,
  SuspiciousBadge,
} from '@/features/analytics/components/bits'
import { num, pct, seconds } from '@/features/analytics/lib/format'

// One question's life with students, across every context it appeared in:
// how often it was met, how it went, which options pulled, how long it took,
// whether it tells strong from weak — and what students said about it.
// Shown inside the ready viewer, under the question itself, so the key and
// the numbers are read together.
const CONTEXT_LABEL: Record<string, string> = {
  deneme: 'Deneme',
  topic_test: 'Mövzu testi',
  roadmap: 'Roadmap',
  placement: 'Səviyyə testi',
}

export function QuestionAnalytics({
  questionId,
  collapsible = false,
}: {
  questionId: number
  /** Folded to one line until opened — for a viewer whose room is the question's. */
  collapsible?: boolean
}) {
  const q = useQuestionAnalytics(questionId)
  const resolve = useResolveReport(questionId)

  if (q.isPending) return <Skeleton className="h-8" />
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
  if (a.responses === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Bu sualı hələ heç bir tələbə işləməyib.
      </p>
    )
  }
  const openReports = a.reports.filter((r) => r.status === 'open')

  const body = (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground font-mono text-[11px] tracking-[0.14em] uppercase">
          Tələbələrlə
        </span>
        {a.suspicious ? <SuspiciousBadge /> : null}
        {openReports.length ? (
          <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-800">
            {openReports.length} açıq bildiriş
          </span>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Stat
          label="İşlənib"
          value={num(a.responses)}
          hint={`${num(a.students)} tələbə`}
        />
        <Stat label="Doğru" value={pct(a.correct_pct)} tone="ok" />
        <Stat label="Boş" value={pct(a.blank_pct)} tone="muted" />
        <Stat
          label="Orta vaxt"
          value={seconds(a.avg_time)}
          hint={`median ${seconds(a.median_time)}`}
        />
        <Stat label="Lövhə" value={pct(a.board_pct)} hint="lövhədə işlənib" />
        <Stat
          label="Ayırd etmə"
          value={a.discrimination === null ? '—' : a.discrimination.toFixed(2)}
          hint={a.discrimination === null ? 'az cəhd' : 'güclü − zəif'}
          tone={
            a.discrimination !== null && a.discrimination < 0.2
              ? 'bad'
              : undefined
          }
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
        <ShareBar
          correct={a.correct_pct ?? 0}
          wrong={a.wrong_pct ?? 0}
          blank={a.blank_pct ?? 0}
        />
        <ChoiceBars choices={a.choices} answer={a.answer} />
      </div>

      {a.by_context.length ? (
        <table className="w-full text-sm">
          <thead className="text-muted-foreground text-xs">
            <tr>
              <th className="pb-1 text-left font-medium">Harada</th>
              <th className="pb-1 text-right font-medium">İşlənib</th>
              <th className="pb-1 text-right font-medium">Doğru</th>
              <th className="pb-1 text-right font-medium">Boş</th>
              <th className="pb-1 text-right font-medium">Vaxt</th>
            </tr>
          </thead>
          <tbody>
            {a.by_context.map((c) => (
              <tr
                key={`${c.context_kind}-${c.context_id}`}
                className="border-t"
              >
                <td className="py-1.5">
                  {c.title ??
                    `${CONTEXT_LABEL[c.context_kind] ?? c.context_kind} #${c.context_id}`}
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  {num(c.responses)}
                </td>
                <td className="py-1.5 text-right text-emerald-700 tabular-nums">
                  {pct(c.correct_pct)}
                </td>
                <td className="py-1.5 text-right text-muted-foreground tabular-nums">
                  {pct(c.blank_pct)}
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  {seconds(c.avg_time)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {a.reports.length ? (
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground font-mono text-[11px] tracking-[0.14em] uppercase">
            Tələbə bildirişləri
          </p>
          <ul className="flex flex-col gap-2">
            {a.reports.map((r) => (
              <li
                key={r.id}
                className={
                  r.status === 'open'
                    ? 'flex items-start gap-3 rounded-lg border border-sky-200 bg-sky-50/50 px-3 py-2'
                    : 'text-muted-foreground flex items-start gap-3 rounded-lg border px-3 py-2'
                }
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm whitespace-pre-wrap">{r.note}</p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {r.student_name ?? 'tələbə'} ·{' '}
                    {new Date(r.created_at).toLocaleDateString('az-AZ')}
                    {r.status !== 'open'
                      ? ` · ${r.status === 'resolved' ? 'həll edilib' : 'rədd edilib'}`
                      : ''}
                  </p>
                </div>
                {r.status === 'open' ? (
                  <div className="flex shrink-0 gap-1">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Həll edildi"
                      title="Həll edildi — sual düzəldilib"
                      disabled={resolve.isPending}
                      onClick={() =>
                        resolve.mutate({ id: r.id, status: 'resolved' })
                      }
                    >
                      <Check />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Rədd et"
                      title="Rədd et — sual düzgündür"
                      disabled={resolve.isPending}
                      onClick={() =>
                        resolve.mutate({ id: r.id, status: 'dismissed' })
                      }
                    >
                      <X />
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )

  if (!collapsible) return body
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 text-sm select-none [&::-webkit-details-marker]:hidden">
        <span className="text-muted-foreground font-mono text-[11px] tracking-[0.14em] uppercase">
          Tələbələrlə
        </span>
        <span className="tabular-nums">{num(a.responses)} işlənib</span>
        <span className="text-emerald-700 tabular-nums">
          {pct(a.correct_pct)} doğru
        </span>
        <span className="text-muted-foreground tabular-nums">
          {pct(a.blank_pct)} boş
        </span>
        <span className="tabular-nums">{seconds(a.avg_time)}</span>
        {a.suspicious ? <SuspiciousBadge /> : null}
        {openReports.length ? (
          <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-800">
            {openReports.length} bildiriş
          </span>
        ) : null}
        <span className="text-muted-foreground ml-auto text-xs group-open:hidden">
          ətraflı ▾
        </span>
        <span className="text-muted-foreground ml-auto hidden text-xs group-open:inline">
          yığ ▴
        </span>
      </summary>
      <div className="max-h-[40vh] overflow-y-auto pt-4">{body}</div>
    </details>
  )
}

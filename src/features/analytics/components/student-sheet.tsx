import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { QueryErrorAlert } from '@/components/query-error-alert'
import { useStudentAnalytics } from '@/features/analytics/api/analytics'
import { ShareBars, TrendLine } from '@/features/analytics/components/charts'
import { ShareBar, Stat } from '@/features/analytics/components/bits'
import { num, pct, seconds } from '@/features/analytics/lib/format'

// One student, opened from a row of sittings: who they are, every sitting
// in order (so the trend is read down the list), how they answer overall,
// and the topics they miss. Read-only; the student's own data is theirs to
// change from their app.
export function StudentSheet({
  userId,
  onClose,
}: {
  userId: string | null
  onClose: () => void
}) {
  const s = useStudentAnalytics(userId)
  return (
    <Sheet open={userId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-2xl"
      >
        {s.isPending ? (
          <div className="flex flex-col gap-4 p-6">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-24" />
            <Skeleton className="h-48" />
          </div>
        ) : s.isError ? (
          <div className="p-6">
            <QueryErrorAlert
              error={s.error}
              onRetry={() => s.refetch()}
              isRetrying={s.isFetching}
            />
          </div>
        ) : (
          <>
            <SheetHeader>
              <SheetTitle>{s.data.profile?.full_name || 'Tələbə'}</SheetTitle>
              <SheetDescription>
                {[
                  s.data.profile?.grade
                    ? `${s.data.profile.grade}-ci sinif`
                    : null,
                  s.data.profile?.goal_score
                    ? `hədəf ${s.data.profile.goal_score}`
                    : null,
                  s.data.profile?.level
                    ? `səviyyə: ${s.data.profile.level}`
                    : null,
                  s.data.profile
                    ? `qeydiyyat ${new Date(s.data.profile.created_at).toLocaleDateString('az-AZ')}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-col gap-6 px-4 pb-6">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Stat label="Cəhd" value={num(s.data.attempts.length)} />
                <Stat
                  label="Dəqiqlik"
                  value={pct(s.data.accuracy_pct)}
                  tone="ok"
                  hint="cavablananlar"
                />
                <Stat label="Boş" value={pct(s.data.blank_pct)} tone="muted" />
                <Stat
                  label="Orta vaxt"
                  value={seconds(s.data.avg_time)}
                  hint="bir suala"
                />
              </div>

              <ShareBar
                correct={
                  s.data.accuracy_pct === null
                    ? 0
                    : (100 - (s.data.blank_pct ?? 0)) *
                      (s.data.accuracy_pct / 100)
                }
                wrong={s.data.wrong_pct ?? 0}
                blank={s.data.blank_pct ?? 0}
              />

              {s.data.attempts.length >= 2 ? (
                <div className="flex flex-col gap-2">
                  <p className="text-muted-foreground font-mono text-[11px] tracking-[0.14em] uppercase">
                    Bal trendi
                  </p>
                  <TrendLine
                    ariaLabel="Cəhdlər üzrə bal, maksimumun faizi ilə"
                    points={s.data.attempts.map((a, i) => ({
                      key: a.id,
                      label: `${i + 1}`,
                      value: a.max_score
                        ? (100 * (a.score ?? 0)) / a.max_score
                        : 0,
                      hint: `${a.title}${a.attempt_no > 1 ? ` · ${a.attempt_no}-ci` : ''} · ${num(a.score, 1)} bal`,
                    }))}
                  />
                </div>
              ) : null}

              <div className="flex flex-col gap-2">
                <p className="text-muted-foreground font-mono text-[11px] tracking-[0.14em] uppercase">
                  Cəhdlər
                </p>
                {s.data.attempts.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    Təhvil verilmiş cəhd yoxdur.
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="text-muted-foreground text-xs">
                      <tr>
                        <th className="pb-1 text-left font-medium">Deneme</th>
                        <th className="pb-1 text-right font-medium">Bal</th>
                        <th className="pb-1 text-right font-medium">
                          D / S / B
                        </th>
                        <th className="pb-1 text-right font-medium">Vaxt</th>
                        <th className="pb-1 text-right font-medium">Tarix</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.data.attempts.map((a) => (
                        <tr key={a.id} className="border-t">
                          <td className="py-1.5">
                            {a.title}
                            {a.attempt_no > 1 ? (
                              <span className="text-muted-foreground">
                                {' '}
                                · {a.attempt_no}-ci
                              </span>
                            ) : null}
                            {a.reviewed ? (
                              <span className="text-muted-foreground text-xs">
                                {' '}
                                · açar görülüb
                              </span>
                            ) : null}
                          </td>
                          <td className="py-1.5 text-right font-medium tabular-nums">
                            {num(a.score, 2)}
                            <span className="text-muted-foreground font-normal">
                              {' '}
                              / {num(a.max_score, 1)}
                            </span>
                          </td>
                          <td className="py-1.5 text-right tabular-nums">
                            <span className="text-emerald-700">
                              {a.correct_count ?? 0}
                            </span>{' '}
                            /{' '}
                            <span className="text-red-700">
                              {a.wrong_count ?? 0}
                            </span>{' '}
                            /{' '}
                            <span className="text-muted-foreground">
                              {a.blank_count ?? 0}
                            </span>
                          </td>
                          <td className="py-1.5 text-right tabular-nums">
                            {seconds(a.time_used_seconds)}
                            {a.submitted_by === 'timeout' ? (
                              <span className="text-amber-700"> ⏱</span>
                            ) : null}
                          </td>
                          <td className="text-muted-foreground py-1.5 text-right text-xs tabular-nums">
                            {a.submitted_at
                              ? new Date(a.submitted_at).toLocaleDateString(
                                  'az-AZ',
                                )
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <p className="text-muted-foreground font-mono text-[11px] tracking-[0.14em] uppercase">
                  Mövzular (zəifdən güclüyə)
                </p>
                {s.data.topics.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    Hələ 3 cavabdan çox toplanan mövzu yoxdur.
                  </p>
                ) : (
                  <ShareBars
                    ariaLabel="Mövzu üzrə doğru, səhv və boş payı"
                    labelWidth={160}
                    rows={s.data.topics.map((t) => ({
                      key: t.category_id,
                      label: t.name,
                      correct: t.correct_pct,
                      wrong: 100 - t.correct_pct - t.blank_pct,
                      blank: t.blank_pct,
                      hint: `${t.subject_name} · ${num(t.responses)} cavab`,
                    }))}
                  />
                )}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

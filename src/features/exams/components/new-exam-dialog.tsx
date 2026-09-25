import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { normalizeError } from '@/lib/errors'
import { useSubjects } from '@/features/taxonomy'
import { useCreateExam } from '@/features/exams/api/exams'
import { maxScoreOf, useTemplates } from '@/features/exams/api/templates'
import { useBankCounts } from '@/features/exams/api/search'
import { cn } from '@/lib/utils'
import { minutesLabel, scoreLabel } from '@/features/exams/lib/format'

// A new exam is ONE choice — which kind — and the name, the number and the
// rules follow from it. Everything else happens in the builder.
export function NewExamDialog({
  programId,
  open,
  onOpenChange,
}: {
  programId: number
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const templates = useTemplates(programId)
  const subjects = useSubjects(programId)
  const create = useCreateExam()
  const subjectName = (id: number) =>
    subjects.data?.find((s) => s.id === id)?.name ?? '—'
  const live = (templates.data ?? []).filter((t) => !t.archived_at)
  const bank = useBankCounts(
    live.flatMap((t) => t.sections.map((s) => s.subject_id)),
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Yeni deneme</DialogTitle>
          <DialogDescription>
            Növünü seçin. Ad, nömrə və qaydalar şablondan gəlir, sualları isə
            növbəti ekranda yığacaqsınız.
          </DialogDescription>
        </DialogHeader>

        {templates.isPending ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : live.length === 0 ? (
          <p className="text-muted-foreground py-6 text-sm">
            Bu proqramda şablon yoxdur. Əvvəlcə Şablonlar səhifəsində birini
            yaradın.
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {live.map((t) => {
              const questions = t.sections.reduce(
                (s, x) => s + x.question_count,
                0,
              )
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    disabled={create.isPending}
                    onClick={() =>
                      create.mutate(t.id, {
                        onSuccess: (exam) => {
                          onOpenChange(false)
                          void navigate(`/exams/${exam.id}`)
                        },
                        onError: (e) => toast.error(normalizeError(e).message),
                      })
                    }
                    className="hover:border-primary/50 hover:bg-muted/40 focus-visible:ring-ring flex w-full flex-col gap-1.5 rounded-lg border p-3.5 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-60"
                  >
                    <span className="font-medium">{t.name}</span>
                    <span className="text-muted-foreground text-xs">
                      {questions} sual · {minutesLabel(t.duration_seconds)} ·
                      maks. {scoreLabel(maxScoreOf(t))} bal
                    </span>
                    {/* What the bank can put in each section, so a
                        template it cannot fill says so BEFORE a draft
                        nobody can publish exists. */}
                    <span className="flex flex-col gap-0.5 text-xs">
                      {t.sections.map((s) => {
                        const have = bank.get(s.subject_id)
                        const short =
                          have !== undefined && have < s.question_count
                        return (
                          <span
                            key={s.position}
                            className={cn(
                              short
                                ? 'text-destructive'
                                : 'text-muted-foreground',
                            )}
                          >
                            {subjectName(s.subject_id)} {s.question_count} ·{' '}
                            {have === undefined
                              ? '…'
                              : have === 0
                                ? 'bankda sual yoxdur'
                                : `bankda ${have} sual`}
                          </span>
                        )
                      })}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {create.isPending ? (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <Spinner className="size-4" /> Yaradılır…
          </p>
        ) : null}
        <div className="flex justify-end">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Bağla
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

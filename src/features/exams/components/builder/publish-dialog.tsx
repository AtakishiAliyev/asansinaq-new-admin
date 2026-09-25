import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Info, Send, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Switch } from '@/components/ui/switch'
import { normalizeError } from '@/lib/errors'
import { usePublishExam } from '@/features/exams/api/publish'
import type { BuilderQuestion, ExamDetail } from '@/features/exams/schemas'
import { hasFigures } from '@/features/exams/lib/question'

type Level = 'ok' | 'block' | 'warn' | 'info'
interface Check {
  level: Level
  text: string
}

const ICON: Record<Level, React.ReactNode> = {
  ok: <CheckCircle2 className="size-4 text-emerald-600" />,
  block: <XCircle className="text-destructive size-4" />,
  warn: <AlertTriangle className="size-4 text-amber-600" />,
  info: <Info className="size-4 text-sky-600" />,
}

// The checks before a version goes out, in the admin's words, and the
// publish itself.
//
// Only what would make the version WRONG blocks: an unfilled section, a
// question that is no longer approved or has no answer. A question another
// exam also uses is a warning — the product decided duplicates are allowed —
// and a question edited in the bank since the last version is information:
// publishing is exactly how that edit reaches students. The server checks
// the blocking ones again; these are here so the button explains itself.
export function PublishDialog({
  open,
  onOpenChange,
  exam,
  sections,
  subjectName,
  settled,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  exam: ExamDetail
  sections: Map<number, BuilderQuestion[]>
  subjectName: (id: number) => string
  /** Every change has been saved. */
  settled: boolean
}) {
  const publish = usePublishExam(exam.id)
  const first = !exam.current
  const [makeVisible, setMakeVisible] = useState(true)
  const [progress, setProgress] = useState<{
    done: number
    total: number
  } | null>(null)

  const all = exam.template.sections.flatMap(
    (s) => sections.get(s.position) ?? [],
  )
  const checks: Check[] = []
  for (const s of exam.template.sections) {
    const n = sections.get(s.position)?.length ?? 0
    checks.push(
      n === s.question_count
        ? {
            level: 'ok',
            text: `${subjectName(s.subject_id)}: ${n} / ${s.question_count}`,
          }
        : {
            level: 'block',
            text: `${subjectName(s.subject_id)}: ${n} / ${s.question_count} — bölmə tam deyil`,
          },
    )
  }
  const unapproved = all.filter(
    (q) => q.status !== undefined && q.status !== 'approved',
  ).length
  const noAnswer = all.filter((q) => !q.answer).length
  const reused = all.filter((q) => q.usageCount > 0).length
  const changed = all.filter((q) => q.changedSincePublish).length
  const withFigures = all.filter(
    (q) => hasFigures(q.figures) || q.options.some((o) => o.image),
  ).length
  if (unapproved)
    checks.push({
      level: 'block',
      text: `${unapproved} sual artıq təsdiqlənmiş deyil`,
    })
  if (noAnswer)
    checks.push({ level: 'block', text: `${noAnswer} sualın cavabı yoxdur` })
  if (reused)
    checks.push({
      level: 'warn',
      text: `${reused} sual başqa denemələrdə də var`,
    })
  if (changed)
    checks.push({
      level: 'info',
      text: `${changed} sual son versiyadan sonra bankda dəyişib — bu dərc onları yeniləyəcək`,
    })
  if (withFigures)
    checks.push({
      level: 'info',
      text: `${withFigures} sualın şəkli hazırlanacaq`,
    })
  if (!settled)
    checks.push({
      level: 'block',
      text: 'Son dəyişikliklər hələ yadda saxlanılır',
    })

  const blocked = checks.some((c) => c.level === 'block')

  const run = () => {
    publish.mutate(
      {
        questions: all,
        makeVisible: first ? makeVisible : false,
        onProgress: (done, total) => setProgress({ done, total }),
      },
      {
        onSuccess: (version) => {
          toast.success(`v${version.version_no} dərc olundu`)
          setProgress(null)
          onOpenChange(false)
        },
        onError: (error) => {
          setProgress(null)
          toast.error(normalizeError(error).message)
        },
      },
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !publish.isPending && onOpenChange(v)}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {first
              ? 'Dərc et'
              : `Yeni versiya: v${(exam.current?.version_no ?? 0) + 1}`}
          </DialogTitle>
          <DialogDescription>
            {first
              ? 'Qaralama dəyişməz bir versiya kimi saxlanılır. Sonrakı dəyişikliklər yeni versiya olacaq.'
              : 'Yarımçıq işləyən tələbələr başladıqları versiyanı bitirəcək, yeni başlayanlar bu versiyanı alacaq.'}
          </DialogDescription>
        </DialogHeader>

        <ul className="flex flex-col gap-2 text-sm">
          {checks.map((c, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0">{ICON[c.level]}</span>
              <span>{c.text}</span>
            </li>
          ))}
        </ul>

        {first ? (
          <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
            <Label htmlFor="make-visible" className="font-normal">
              Dərcdən sonra tələbələrə göstər
            </Label>
            <Switch
              id="make-visible"
              checked={makeVisible}
              onCheckedChange={setMakeVisible}
            />
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            {exam.is_visible
              ? 'Deneme tələbələrə açıqdır — yeni versiyanı dərhal görəcəklər.'
              : 'Deneme gizlidir — dərcdən sonra da gizli qalacaq.'}
          </p>
        )}

        {progress ? (
          <div className="flex flex-col gap-1.5">
            <Progress
              value={
                progress.total ? (progress.done / progress.total) * 100 : 100
              }
            />
            <p className="text-muted-foreground text-xs">
              {progress.done < progress.total
                ? `Şəkillər hazırlanır: ${progress.done} / ${progress.total}`
                : 'Versiya yazılır…'}
            </p>
          </div>
        ) : null}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={publish.isPending}
          >
            Ləğv et
          </Button>
          <Button onClick={run} disabled={blocked || publish.isPending}>
            <Send /> {first ? 'Dərc et' : 'Yeni versiyanı dərc et'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

import { useState } from 'react'
import { Link } from 'react-router'
import { ArrowLeft, Check, Eye, History, Send, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { normalizeError } from '@/lib/errors'
import {
  examState,
  useUpdateExam,
  useVersions,
} from '@/features/exams/api/exams'
import type { ExamDetail } from '@/features/exams/schemas'
import { ExamStateBadge } from '@/features/exams/components/exam-state-badge'
import type { SaveState } from '@/features/exams/components/builder/use-builder'
import {
  dateLabel,
  minutesLabel,
  scoreLabel,
} from '@/features/exams/lib/format'

const SAVE_TEXT: Record<SaveState, string> = {
  idle: '',
  pending: 'Dəyişiklik var…',
  saving: 'Yadda saxlanılır…',
  saved: 'Yadda saxlanıldı',
  error: 'Yadda saxlanmadı',
}

export function BuilderHeader({
  exam,
  saveState,
  onAutofill,
  onPreview,
  onPublish,
}: {
  exam: ExamDetail
  saveState: SaveState
  onAutofill: () => void
  onPreview: () => void
  onPublish: () => void
}) {
  const update = useUpdateExam(exam.id)
  const [title, setTitle] = useState(exam.title)
  const [lastTitle, setLastTitle] = useState(exam.title)
  if (lastTitle !== exam.title) {
    setLastTitle(exam.title)
    setTitle(exam.title)
  }

  const commitTitle = () => {
    const next = title.trim()
    if (!next) {
      setTitle(exam.title)
      return
    }
    if (next === exam.title) return
    update.mutate(
      { title: next },
      { onError: (e) => toast.error(normalizeError(e).message) },
    )
  }

  const state = examState(exam)

  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3">
      <Button variant="ghost" size="icon" asChild aria-label="Denemələrə qayıt">
        <Link to="/exams">
          <ArrowLeft />
        </Link>
      </Button>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') {
              setTitle(exam.title)
              e.currentTarget.blur()
            }
          }}
          aria-label="Denemənin adı"
          className="h-8 max-w-sm border-transparent px-1.5 text-lg font-semibold shadow-none hover:border-input focus-visible:border-input"
        />
        <div className="text-muted-foreground flex flex-wrap items-center gap-2 px-1.5 text-xs">
          <Badge variant="secondary">{exam.template.name}</Badge>
          <span>
            {exam.template.sections.reduce((s, x) => s + x.question_count, 0)}{' '}
            sual · {minutesLabel(exam.template.duration_seconds)}
          </span>
          <ExamStateBadge
            state={state}
            versionNo={exam.current?.version_no ?? null}
          />
          {SAVE_TEXT[saveState] ? (
            <span className={saveState === 'error' ? 'text-destructive' : ''}>
              {saveState === 'saving' ? (
                <Spinner className="mr-1 inline size-3" />
              ) : null}
              {saveState === 'saved' ? (
                <Check className="mr-0.5 inline size-3" />
              ) : null}
              {SAVE_TEXT[saveState]}
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {exam.current ? (
          <label className="text-muted-foreground mr-1 flex items-center gap-2 text-sm">
            Tələbələr
            <Switch
              checked={exam.is_visible}
              disabled={update.isPending}
              onCheckedChange={(v) =>
                update.mutate(
                  { is_visible: v },
                  {
                    onSuccess: () =>
                      toast.success(
                        v ? 'Tələbələrə göstərilir' : 'Tələbələrdən gizlədildi',
                      ),
                    onError: (e) => toast.error(normalizeError(e).message),
                  },
                )
              }
            />
          </label>
        ) : null}
        {exam.current ? <VersionsButton examId={exam.id} /> : null}
        <Button variant="outline" onClick={onAutofill}>
          <Wand2 /> Avtomatik doldur
        </Button>
        <Button variant="outline" onClick={onPreview}>
          <Eye /> Önizlə
        </Button>
        <Button onClick={onPublish}>
          <Send /> {exam.current ? 'Yeni versiya' : 'Dərc et'}
        </Button>
      </div>
    </header>
  )
}

function VersionsButton({ examId }: { examId: number }) {
  const versions = useVersions(examId)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Versiyalar">
          <History />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <p className="mb-2 text-sm font-medium">Versiyalar</p>
        {versions.isPending ? (
          <Spinner className="size-4" />
        ) : (
          <ul className="flex flex-col gap-1.5 text-sm">
            {(versions.data ?? []).map((v, i) => (
              <li
                key={v.id}
                className="flex items-baseline justify-between gap-3"
              >
                <span className="font-medium">
                  v{v.version_no}
                  {i === 0 ? (
                    <span className="text-muted-foreground ml-1 text-xs font-normal">
                      cari
                    </span>
                  ) : null}
                </span>
                <span className="text-muted-foreground text-xs">
                  {dateLabel(v.published_at)} · {v.question_count} sual ·{' '}
                  {scoreLabel(v.max_score)} bal
                </span>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}

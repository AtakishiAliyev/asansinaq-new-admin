import { useCallback, useMemo } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { QuestionPreview } from '@/components/question/question-preview'
import { useSignedUrls } from '@/features/questions'
import type { BuilderQuestion, Template } from '@/features/exams/schemas'
import { imagePathsOf } from '@/features/exams/lib/question'
import {
  minutesLabel,
  penaltyLabel,
  scoreLabel,
} from '@/features/exams/lib/format'
import { maxScoreOf } from '@/features/exams/api/templates'

function useResolver(questions: BuilderQuestion[], enabled: boolean) {
  const paths = useMemo(
    () => (enabled ? questions.flatMap(imagePathsOf) : []),
    [questions, enabled],
  )
  const signed = useSignedUrls(paths)
  return useCallback(
    (src: string) => signed.data?.get(src) ?? src,
    [signed.data],
  )
}

/** One question, full size, with its answer — what a slot's eye opens. */
export function QuestionDialog({
  question,
  topicName,
  onOpenChange,
}: {
  question: BuilderQuestion | null
  topicName: string
  onOpenChange: (open: boolean) => void
}) {
  const list = useMemo(() => (question ? [question] : []), [question])
  const resolve = useResolver(list, question !== null)
  return (
    <Dialog open={question !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        {question ? (
          <>
            <DialogHeader>
              <DialogTitle>#{question.id}</DialogTitle>
              <DialogDescription>{topicName}</DialogDescription>
            </DialogHeader>
            <QuestionPreview
              question={question}
              answer={question.answer}
              resolveImageUrl={resolve}
            />
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

// The exam as a student would meet it: every section in order, numbered
// straight through, and NO answer marked — the one difference from every
// other view of these questions in the panel.
export function ExamPreviewDialog({
  open,
  onOpenChange,
  title,
  template,
  sections,
  subjectName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  template: Template
  sections: Map<number, BuilderQuestion[]>
  subjectName: (id: number) => string
}) {
  const all = useMemo(
    () => template.sections.flatMap((s) => sections.get(s.position) ?? []),
    [template.sections, sections],
  )
  const resolve = useResolver(all, open)
  let number = 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {all.length} sual · {minutesLabel(template.duration_seconds)} ·
            maks. {scoreLabel(maxScoreOf(template))} bal
            {template.sections[0]
              ? ` · ${penaltyLabel(template.sections[0].penalty_ratio)}`
              : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-8">
          {template.sections.map((s) => {
            const qs = sections.get(s.position) ?? []
            return (
              <section key={s.position} className="flex flex-col gap-6">
                {template.sections.length > 1 ? (
                  <h3 className="border-b pb-2 text-sm font-semibold">
                    {subjectName(s.subject_id)} · {qs.length} sual
                  </h3>
                ) : null}
                {qs.map((q) => {
                  number += 1
                  return (
                    <div key={q.id} className="flex gap-3">
                      <span className="text-muted-foreground w-6 shrink-0 pt-0.5 text-right text-sm font-semibold tabular-nums">
                        {number}.
                      </span>
                      <div className="min-w-0 flex-1">
                        <QuestionPreview
                          question={q}
                          resolveImageUrl={resolve}
                        />
                      </div>
                    </div>
                  )
                })}
                {qs.length < s.question_count ? (
                  <p className="text-muted-foreground rounded-md border border-dashed py-3 text-center text-xs">
                    {s.question_count - qs.length} sual hələ seçilməyib
                  </p>
                ) : null}
              </section>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}

import { memo } from 'react'
import { Check, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { QuestionPreview } from '@/components/question/question-preview'
import { cn } from '@/lib/utils'
import type { BuilderQuestion } from '@/features/exams/schemas'
import { DifficultyTag } from '@/features/exams/components/builder/difficulty-badge'

// One question in the search list. The question itself is shown in full —
// the builder is choosing by content, and a title line would make the admin
// open every row — with the answer marked, because an exam built by someone
// who cannot see the key is built blind.
export const ResultRow = memo(function ResultRow({
  question,
  topicName,
  inExam,
  canAdd,
  focused,
  resolveImageUrl,
  onAdd,
  onFocus,
}: {
  question: BuilderQuestion
  topicName: string
  inExam: boolean
  canAdd: boolean
  focused: boolean
  resolveImageUrl: (src: string) => string
  onAdd: (q: BuilderQuestion) => void
  onFocus: () => void
}) {
  const source = question.source
  return (
    <div
      onClick={onFocus}
      className={cn(
        'border-b px-4 py-3 transition-colors',
        focused
          ? 'bg-primary/5 ring-primary/40 ring-1 ring-inset'
          : 'hover:bg-muted/30',
        inExam && 'bg-muted/40',
      )}
    >
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="text-muted-foreground font-mono">#{question.id}</span>
        <span className="font-medium">{topicName}</span>
        <DifficultyTag value={question.difficulty} />
        {source?.page ? (
          <span className="text-muted-foreground">
            s. {source.page}
            {source.qNo ? ` / ${source.qNo}` : ''}
          </span>
        ) : null}
        {question.usageCount > 0 ? (
          <Badge
            variant="outline"
            className="border-amber-500/50 text-amber-700 dark:text-amber-400"
          >
            {question.usageCount} denemədə var
          </Badge>
        ) : null}
        <span className="ml-auto">
          {inExam ? (
            <span className="text-muted-foreground inline-flex items-center gap-1">
              <Check className="size-3.5" /> Əlavə olunub
            </span>
          ) : (
            <Button
              size="sm"
              variant={focused ? 'default' : 'outline'}
              disabled={!canAdd}
              title={canAdd ? 'Əlavə et (Enter)' : 'Bu bölmə doludur'}
              onClick={(e) => {
                e.stopPropagation()
                onAdd(question)
              }}
            >
              <Plus /> Əlavə et
            </Button>
          )}
        </span>
      </div>
      <QuestionPreview
        question={question}
        answer={question.answer}
        density="compact"
        resolveImageUrl={resolveImageUrl}
      />
    </div>
  )
})

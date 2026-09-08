import { Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import type { Category } from '@/features/taxonomy'
import { CategoryPicker } from '@/features/questions/components/category-picker'

const DIFFICULTIES = [1, 2, 3, 4, 5] as const
export const ANSWERS = ['A', 'B', 'C', 'D', 'E'] as const

// The answer never comes from a model — only from the printed key or from a
// reviewer. Without this control a book with no printed key had no path to an
// answer at all, which left its questions unusable in the bank.
function AnswerPicker({
  value,
  source,
  onChange,
}: {
  value: string | null
  source: string | null
  onChange: (answer: string) => void
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-muted-foreground text-xs">Cavab:</span>
      {ANSWERS.map((a) => (
        <Button
          key={a}
          size="icon-sm"
          variant={value === a ? 'secondary' : 'ghost'}
          aria-pressed={value === a}
          aria-label={`Cavab ${a} (Shift+${a})`}
          onClick={() => onChange(a)}
        >
          {a}
        </Button>
      ))}
      {value === null ? (
        <span className="text-xs text-amber-700">yoxdur</span>
      ) : (
        <span className="text-muted-foreground text-xs">
          {source === 'key'
            ? '(açardan)'
            : source === 'reviewer'
              ? '(əl ilə)'
              : ''}
        </span>
      )}
    </div>
  )
}

export function ReviewActions({
  categories,
  categoryId,
  onCategoryChange,
  suggestion,
  aiDifficulty,
  difficulty,
  onDifficultyChange,
  answer,
  answerSource,
  onAnswerChange,
  busy,
  canApprove,
  isApproving,
  onReject,
  onApprove,
}: {
  categories: Category[]
  categoryId: number | null
  onCategoryChange: (id: number) => void
  suggestion: number | null
  aiDifficulty: number | null
  difficulty: number | null
  onDifficultyChange: (value: number) => void
  answer: string | null
  answerSource: string | null
  onAnswerChange: (answer: string) => void
  busy: boolean
  canApprove: boolean
  isApproving: boolean
  onReject: () => void
  onApprove: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t pt-3">
      <CategoryPicker
        categories={categories}
        value={categoryId}
        onChange={onCategoryChange}
        suggestion={suggestion}
      />
      <AnswerPicker
        value={answer}
        source={answerSource}
        onChange={onAnswerChange}
      />
      <div className="flex items-center gap-1">
        <span className="text-muted-foreground text-xs">Çətinlik:</span>
        {DIFFICULTIES.map((d) => (
          <Button
            key={d}
            size="icon-sm"
            variant={difficulty === d ? 'secondary' : 'ghost'}
            aria-pressed={difficulty === d}
            onClick={() => onDifficultyChange(d)}
          >
            {d}
          </Button>
        ))}
        {aiDifficulty ? (
          <span className="text-muted-foreground text-xs">
            (AI: {aiDifficulty})
          </span>
        ) : null}
      </div>

      {/* Two buttons, and they are the two outcomes. Three repair controls used
          to sit here — re-extract, edit fields, edit figure geometry — and each
          was a way to produce a question the extraction lane never saw. A row
          that is wrong is rejected and goes back through the pipeline. */}
      <div className="ml-auto flex items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          className="text-destructive"
          onClick={onReject}
          disabled={busy}
        >
          <X data-icon="inline-start" />
          Rədd et (D)
        </Button>
        <Button size="sm" onClick={onApprove} disabled={busy || !canApprove}>
          {isApproving ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <Check data-icon="inline-start" />
          )}
          Təsdiqlə (A)
        </Button>
      </div>
    </div>
  )
}

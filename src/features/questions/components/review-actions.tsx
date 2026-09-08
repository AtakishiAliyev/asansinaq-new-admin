import { Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import type { Category } from '@/features/taxonomy'
import { CategoryPicker } from '@/features/questions/components/category-picker'

const DIFFICULTIES = [1, 2, 3, 4, 5] as const
export const ANSWERS = ['A', 'B', 'C', 'D', 'E'] as const

/**
 * One labelled control in the decision bar.
 *
 * The three attributes used to sit in a single wrapping row with their labels
 * inline and the two decision buttons after them, so on a narrow window a
 * reviewer got "Cavab:" on one line and "Təsdiqlə" tucked between two pickers
 * on the next. Stacking the label over its control gives every group the same
 * shape and lets the row wrap without the meaning moving.
 */
function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground font-mono text-[10px] tracking-[0.12em] uppercase">
        {label}
        {hint ? <span className="ml-1 normal-case opacity-70">{hint}</span> : null}
      </span>
      <div className="flex items-center gap-1">{children}</div>
    </div>
  )
}

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
  const origin =
    value === null
      ? null
      : source === 'key'
        ? 'açardan'
        : source === 'reviewer'
          ? 'əl ilə'
          : null
  return (
    <Field label="Cavab" hint={origin ?? undefined}>
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
        <span className="ml-1 text-xs text-amber-700">yoxdur</span>
      ) : null}
    </Field>
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
    // What the row is FOR, then what to do about it — and the two never
    // interleave. `items-end` keeps the buttons on the controls' baseline
    // rather than floating against the taller labelled groups.
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-t pt-3">
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
        <Field label="Mövzu">
          <CategoryPicker
            categories={categories}
            value={categoryId}
            onChange={onCategoryChange}
            suggestion={suggestion}
          />
        </Field>
        <AnswerPicker
          value={answer}
          source={answerSource}
          onChange={onAnswerChange}
        />
        <Field
          label="Çətinlik"
          hint={aiDifficulty ? `AI: ${aiDifficulty}` : undefined}
        >
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
        </Field>
      </div>

      {/* Two buttons, and they are the two outcomes. Three repair controls used
          to sit here — re-extract, edit fields, edit figure geometry — and each
          was a way to produce a question the extraction lane never saw. A row
          that is wrong is rejected and goes back through the pipeline. */}
      <div className="flex shrink-0 items-center gap-1.5">
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

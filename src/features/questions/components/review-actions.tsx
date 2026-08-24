import { useState } from 'react'
import { Check, Pencil, RefreshCw, Shapes, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import type { Category } from '@/features/taxonomy'

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
          {source === 'key' ? '(açardan)' : source === 'reviewer' ? '(əl ilə)' : ''}
        </span>
      )}
    </div>
  )
}

function CategoryPicker({
  categories,
  value,
  onChange,
  suggestion,
}: {
  categories: Category[]
  value: number | null
  onChange: (id: number) => void
  suggestion: number | null
}) {
  const [open, setOpen] = useState(false)
  const byId = new Map(categories.map((c) => [c.id, c]))
  const label = (c: Category) => {
    const parent = c.parent_id ? byId.get(c.parent_id) : null
    return parent ? `${parent.name} → ${c.name}` : c.name
  }
  const selected = value ? byId.get(value) : null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="max-w-64 justify-start">
          <span className="truncate">
            {selected ? label(selected) : 'Kateqoriya seç'}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="Kateqoriya axtar…" />
          <CommandList>
            <CommandEmpty>Kateqoriya tapılmadı.</CommandEmpty>
            <CommandGroup>
              {categories.map((c) => (
                <CommandItem
                  key={c.id}
                  value={`${label(c)} ${c.id}`}
                  onSelect={() => {
                    onChange(c.id)
                    setOpen(false)
                  }}
                >
                  {label(c)}
                  {c.id === suggestion ? (
                    <Badge
                      variant="outline"
                      className="ml-auto border-violet-200 bg-violet-50 text-[10px] text-violet-700"
                    >
                      AI təklifi
                    </Badge>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
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
  canEdit,
  canEditFigure,
  isApproving,
  onRestructure,
  onEdit,
  onEditFigure,
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
  canEdit: boolean
  /** A geometry figure is present, so its data can be edited directly. */
  canEditFigure: boolean
  isApproving: boolean
  onRestructure: () => void
  onEdit: () => void
  onEditFigure: () => void
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
      <AnswerPicker value={answer} source={answerSource} onChange={onAnswerChange} />
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
          <span className="text-muted-foreground text-xs">(AI: {aiDifficulty})</span>
        ) : null}
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <Button variant="outline" size="sm" onClick={onRestructure} disabled={busy}>
          <RefreshCw data-icon="inline-start" />
          Yenidən çıxar
        </Button>
        <Button variant="outline" size="sm" onClick={onEdit} disabled={busy || !canEdit}>
          <Pencil data-icon="inline-start" />
          Redaktə (E)
        </Button>
        {/* Beside "yenidən çıxar" on purpose. A re-run is the expensive,
            unaimable option and this is the cheap, exact one, so a reviewer
            looking at a figure that is one field wrong should see both and
            reach for this. */}
        <Button
          variant="outline"
          size="sm"
          onClick={onEditFigure}
          disabled={busy || !canEditFigure}
          title={
            canEditFigure
              ? 'Fiqurun məlumatını redaktə et (F)'
              : 'Redaktə olunan həndəsi fiqur yoxdur'
          }
        >
          <Shapes data-icon="inline-start" />
          Fiqur (F)
        </Button>
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

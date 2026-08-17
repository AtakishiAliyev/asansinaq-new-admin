import { useState } from 'react'
import { Check, Pencil, RefreshCw, X } from 'lucide-react'
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
  busy,
  canApprove,
  canEdit,
  isApproving,
  onRestructure,
  onEdit,
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
  busy: boolean
  canApprove: boolean
  canEdit: boolean
  isApproving: boolean
  onRestructure: () => void
  onEdit: () => void
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

import { useState } from 'react'
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
import type { Category } from '@/features/taxonomy'

/** A parent's child reads `Parent → Child`; a root reads as itself. */
export function categoryLabel(
  categories: Category[],
  id: number | null,
): string | null {
  if (id === null) return null
  const byId = new Map(categories.map((c) => [c.id, c]))
  const c = byId.get(id)
  if (!c) return null
  const parent = c.parent_id ? byId.get(c.parent_id) : null
  return parent ? `${parent.name} → ${c.name}` : c.name
}

// One picker for both places a topic is chosen: on the import page, where the
// operator files the crops before they are read, and on the review screen,
// where a reviewer confirms or replaces what was filed. A model's suggestion,
// where there is one, is marked rather than pre-selected.
export function CategoryPicker({
  categories,
  value,
  onChange,
  suggestion = null,
  placeholder = 'Kateqoriya seç',
  size = 'sm',
}: {
  categories: Category[]
  value: number | null
  onChange: (id: number) => void
  suggestion?: number | null
  placeholder?: string
  size?: 'sm' | 'default'
}) {
  const [open, setOpen] = useState(false)
  const selected = categoryLabel(categories, value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size={size}
          className="max-w-64 justify-start"
        >
          <span className="truncate">{selected ?? placeholder}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="Kateqoriya axtar…" />
          <CommandList>
            <CommandEmpty>Kateqoriya tapılmadı.</CommandEmpty>
            <CommandGroup>
              {categories.map((c) => {
                const label = categoryLabel(categories, c.id) ?? c.name
                return (
                  <CommandItem
                    key={c.id}
                    value={`${label} ${c.id}`}
                    onSelect={() => {
                      onChange(c.id)
                      setOpen(false)
                    }}
                  >
                    {label}
                    {c.id === suggestion ? (
                      <Badge
                        variant="outline"
                        className="ml-auto border-violet-200 bg-violet-50 text-[10px] text-violet-700"
                      >
                        AI təklifi
                      </Badge>
                    ) : null}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

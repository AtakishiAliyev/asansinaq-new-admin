import { useMemo } from 'react'
import { Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import {
  DIFFICULTY_LABEL,
  DIFFICULTY_LEVELS,
} from '@/core/questions/difficulty'
import type { Category } from '@/features/taxonomy'
import type { FacetRow, FiguresFilter } from '@/features/exams/schemas'
import {
  EMPTY_FILTERS,
  type PanelFilters,
} from '@/features/exams/lib/panel-filters'
import { DifficultyDot } from '@/features/exams/components/builder/difficulty-badge'

const FIGURE_OPTIONS: { value: FiguresFilter; label: string }[] = [
  { value: 'any', label: 'Hamısı' },
  { value: 'without', label: 'Şəkilsiz' },
  { value: 'with', label: 'Şəkilli' },
]

// The left column. Every count here is what pressing that filter WOULD
// leave, computed from the other filters — so an option that leads nowhere
// says "0" before anyone presses it.
export function FilterPanel({
  filters,
  onChange,
  categories,
  facets,
  searchRef,
}: {
  filters: PanelFilters
  onChange: (next: PanelFilters) => void
  categories: Category[]
  facets: FacetRow[]
  searchRef: React.RefObject<HTMLInputElement | null>
}) {
  const { topicCount, difficultyCount } = useMemo(() => {
    const topic = new Map<number, number>()
    const difficulty = new Map<number, number>()
    for (const f of facets) {
      if (f.category_id === null) continue
      const diffOk =
        !filters.difficulties.length ||
        (f.difficulty !== null && filters.difficulties.includes(f.difficulty))
      const topicOk =
        !filters.categoryIds.length ||
        filters.categoryIds.includes(f.category_id)
      if (diffOk)
        topic.set(f.category_id, (topic.get(f.category_id) ?? 0) + f.n)
      if (topicOk && f.difficulty !== null)
        difficulty.set(f.difficulty, (difficulty.get(f.difficulty) ?? 0) + f.n)
    }
    return { topicCount: topic, difficultyCount: difficulty }
  }, [facets, filters.categoryIds, filters.difficulties])

  const toggle = (list: number[], value: number) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value]

  const dirty =
    filters.categoryIds.length > 0 ||
    filters.difficulties.length > 0 ||
    filters.figures !== 'any' ||
    filters.search.trim() !== '' ||
    filters.unusedOnly

  return (
    <div className="flex flex-col gap-5 p-4">
      <div className="relative">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
        <Input
          ref={searchRef}
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          placeholder="Mətndə axtar  /"
          className="pl-8"
          aria-label="Sual mətnində axtar"
        />
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Çətinlik
        </h3>
        {DIFFICULTY_LEVELS.map((d) => (
          <label
            key={d}
            className="flex cursor-pointer items-center gap-2 text-sm"
          >
            <Checkbox
              checked={filters.difficulties.includes(d)}
              onCheckedChange={() =>
                onChange({
                  ...filters,
                  difficulties: toggle(filters.difficulties, d),
                })
              }
            />
            <DifficultyDot value={d} />
            <span className="flex-1 capitalize">{DIFFICULTY_LABEL[d]}</span>
            <span className="text-muted-foreground text-xs tabular-nums">
              {difficultyCount.get(d) ?? 0}
            </span>
          </label>
        ))}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Mövzular
          </h3>
          {filters.categoryIds.length ? (
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground text-xs"
              onClick={() => onChange({ ...filters, categoryIds: [] })}
            >
              Təmizlə
            </button>
          ) : null}
        </div>
        {categories.map((c) => {
          const n = topicCount.get(c.id) ?? 0
          return (
            <label
              key={c.id}
              className={cn(
                'flex cursor-pointer items-center gap-2 text-sm',
                c.parent_id && 'pl-4',
                n === 0 && 'opacity-50',
              )}
            >
              <Checkbox
                checked={filters.categoryIds.includes(c.id)}
                onCheckedChange={() =>
                  onChange({
                    ...filters,
                    categoryIds: toggle(filters.categoryIds, c.id),
                  })
                }
              />
              <span className="flex-1 truncate" title={c.name}>
                {c.name}
              </span>
              <span className="text-muted-foreground text-xs tabular-nums">
                {n}
              </span>
            </label>
          )
        })}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Şəkil
        </h3>
        <div
          className="bg-muted flex rounded-md p-0.5"
          role="radiogroup"
          aria-label="Şəkil"
        >
          {FIGURE_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={filters.figures === o.value}
              onClick={() => onChange({ ...filters, figures: o.value })}
              className={cn(
                'flex-1 rounded px-2 py-1 text-xs transition-colors',
                filters.figures === o.value
                  ? 'bg-background shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </section>

      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="unused-only" className="text-sm font-normal">
          Yalnız heç bir denemədə olmayanlar
        </Label>
        <Switch
          id="unused-only"
          checked={filters.unusedOnly}
          onCheckedChange={(v) => onChange({ ...filters, unusedOnly: v })}
        />
      </div>

      {dirty ? (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => onChange(EMPTY_FILTERS)}
        >
          <X /> Filtrləri sıfırla
        </Button>
      ) : null}
    </div>
  )
}

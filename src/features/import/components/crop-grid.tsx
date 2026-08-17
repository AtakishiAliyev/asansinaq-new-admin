import { useEffect, useRef, useState } from 'react'
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Hash,
  Image,
  Info,
  Sparkles,
  Table2,
  TriangleAlert,
  Type,
  ZoomIn,
} from 'lucide-react'
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { Crop } from '@/core/segment/types'
import type { PageResult } from '@/features/import/hooks/use-segmentation'

// The review surface: results grouped per page under sticky notebook-style
// headers, crops as white "paper slips" on a tinted ground, one click away
// from a full-size reading view. Color is semantic only — path badges,
// figure chips, and warning notes each get their own hue so the eye can
// triage without reading.

const FIGURE_CHIP = {
  colored: {
    label: 'rəngli fiqur',
    icon: Image,
    className: 'border-sky-200 bg-sky-50 text-sky-700',
  },
  rule: {
    label: 'sxem/cədvəl',
    icon: Table2,
    className: 'border-amber-200 bg-amber-50 text-amber-800',
  },
  none: null,
} as const

// Redundant with the path badge in the section header — hide, don't repeat.
const PATH_NOTE = 'Skan rejimi: sual sərhədləri AI ilə tapılıb'

function isWarningNote(note: string) {
  return /alınmadı|tapmadı|tapılmadı/.test(note)
}

interface FlatCrop {
  crop: Crop
  page: PageResult
}

function PathBadge({ page }: { page: PageResult }) {
  if (page.isScan) {
    return page.crops.length > 0 ? (
      <Badge
        variant="outline"
        className="border-violet-200 bg-violet-50 text-violet-700"
      >
        <Sparkles />
        AI aşkarlama
      </Badge>
    ) : (
      <Badge
        variant="outline"
        className="border-destructive/30 bg-destructive/10 text-destructive"
      >
        <TriangleAlert />
        AI alınmadı
      </Badge>
    )
  }
  return (
    <Badge
      variant="outline"
      className="border-emerald-200 bg-emerald-50 text-emerald-700"
    >
      <Type />
      mətn qatı
    </Badge>
  )
}

export interface CropSelection {
  /** natural keys eligible for selection (persisted, not yet structured) */
  eligible: Set<string>
  selected: Set<string>
  onToggle: (key: string) => void
}

function CropCard({
  crop,
  onOpen,
  selectionKey,
  selection,
}: {
  crop: Crop
  onOpen: () => void
  selectionKey: string
  selection?: CropSelection
}) {
  const chip = FIGURE_CHIP[crop.figureKind]
  const selectable = selection?.eligible.has(selectionKey) ?? false
  const isSelected = selection?.selected.has(selectionKey) ?? false
  return (
    <figure
      className={cn(
        'group bg-card flex flex-col overflow-hidden rounded-lg border shadow-xs transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-md',
        isSelected && 'ring-primary/50 border-primary/50 ring-2',
      )}
    >
      <figcaption className="bg-muted/40 flex items-center justify-between gap-2 border-b px-2.5 py-1.5">
        <span className="flex items-center gap-2">
          {selectable ? (
            <button
              type="button"
              role="checkbox"
              aria-checked={isSelected}
              aria-label={`Sual ${crop.number} seç`}
              onClick={() => selection?.onToggle(selectionKey)}
              className={cn(
                'flex size-4.5 items-center justify-center rounded border transition-colors',
                isSelected
                  ? 'bg-primary border-primary text-primary-foreground'
                  : 'bg-background hover:border-primary/50',
              )}
            >
              {isSelected ? <Check className="size-3" /> : null}
            </button>
          ) : null}
          <span className="font-mono text-xs font-medium tracking-wide tabular-nums">
            №{crop.number}
          </span>
        </span>
        {chip ? (
          <Badge variant="outline" className={cn('text-[11px]', chip.className)}>
            <chip.icon />
            {chip.label}
          </Badge>
        ) : null}
      </figcaption>
      {/* Standard card height, text at full size: crops render top-anchored
          at natural scale; a taller-than-the-window crop clips behind a white
          fade that says "there is more — open it". Nothing is ever cut
          silently, and no crop is shrunk into unreadability to fit. */}
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Sual ${crop.number}, səhifə ${crop.pageNumber} — böyüt`}
        className="relative block h-56 w-full cursor-zoom-in overflow-hidden bg-white p-2"
      >
        {/* lazy + async: a 300-page run must not decode 2000+ offscreen JPEGs */}
        <img
          src={crop.dataUrl}
          alt=""
          className="w-full"
          loading="lazy"
          decoding="async"
          draggable={false}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-white to-transparent"
        />
        <span
          aria-hidden
          className="bg-background/90 text-muted-foreground absolute top-2 right-2 rounded-md border p-1 opacity-0 shadow-xs transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        >
          <ZoomIn className="size-3.5" />
        </span>
      </button>
    </figure>
  )
}

// Full-size reading view; ← → walks every crop of the whole run in order.
function CropLightbox({
  items,
  index,
  onNavigate,
  onClose,
}: {
  items: FlatCrop[]
  index: number | null
  onNavigate: (index: number) => void
  onClose: () => void
}) {
  // Document-level so arrows keep working when a chevron loses focus at the
  // ends of the list (same rationale as the page-preview dialog).
  useEffect(() => {
    if (index === null) return
    function onKeyDown(e: KeyboardEvent) {
      if (index === null) return
      if (e.key === 'ArrowLeft' && index > 0) onNavigate(index - 1)
      if (e.key === 'ArrowRight' && index < items.length - 1)
        onNavigate(index + 1)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [index, items.length, onNavigate])

  const item = index === null ? null : items[index]
  if (!item || index === null) return null
  const atStart = index <= 0
  const atEnd = index >= items.length - 1

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-3 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono text-sm tracking-[0.14em] uppercase">
              Səhifə {item.page.pageNumber} · Sual {item.crop.number}
            </span>
            <PathBadge page={item.page} />
          </DialogTitle>
          <DialogDescription className="sr-only">
            Sualın böyüdülmüş görünüşü — ox düymələri ilə suallar arasında
            keçin.
          </DialogDescription>
        </DialogHeader>

        <div
          tabIndex={0}
          role="region"
          aria-label={`Sual ${item.crop.number} görüntüsü`}
          className="focus-visible:ring-ring min-h-0 flex-1 overflow-auto rounded-md border bg-white p-3 focus-visible:ring-2 focus-visible:outline-none"
        >
          <img
            src={item.crop.dataUrl}
            alt={`Sual ${item.crop.number}, səhifə ${item.page.pageNumber}`}
            className="w-full"
            draggable={false}
          />
        </div>

        <div className="flex items-center justify-between gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label="Əvvəlki sual"
            aria-disabled={atStart}
            className={atStart ? 'pointer-events-none opacity-50' : undefined}
            onClick={() => !atStart && onNavigate(index - 1)}
          >
            <ChevronLeft />
          </Button>
          <span className="text-muted-foreground text-sm tabular-nums">
            {index + 1} / {items.length}
          </span>
          <Button
            variant="outline"
            size="icon"
            aria-label="Növbəti sual"
            aria-disabled={atEnd}
            className={atEnd ? 'pointer-events-none opacity-50' : undefined}
            onClick={() => !atEnd && onNavigate(index + 1)}
          >
            <ChevronRight />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

type PageFilter = 'all' | 'attention' | 'empty'

function needsAttention(page: PageResult) {
  return page.crops.length === 0 || page.notes.some(isWarningNote)
}

const FILTERS: { key: PageFilter; label: string }[] = [
  { key: 'all', label: 'Hamısı' },
  { key: 'attention', label: 'Xəbərdarlıqlı' },
  { key: 'empty', label: 'Boş' },
]

function matchesFilter(page: PageResult, filter: PageFilter) {
  if (filter === 'attention') return needsAttention(page)
  if (filter === 'empty') return page.crops.length === 0
  return true
}

// Searchable jump list: with hundreds of pages a scrollbar is not navigation.
function PageJump({
  results,
  onJump,
}: {
  results: PageResult[]
  onJump: (pageNumber: number) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Hash data-icon="inline-start" />
          Səhifəyə keç
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-60 p-0"
        align="end"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <Command>
          <CommandInput placeholder="Səhifə nömrəsi…" />
          <CommandList>
            <CommandEmpty>Səhifə tapılmadı.</CommandEmpty>
            <CommandGroup>
              {results.map((page) => (
                <CommandItem
                  key={page.pageNumber}
                  value={String(page.pageNumber)}
                  onSelect={() => {
                    setOpen(false)
                    onJump(page.pageNumber)
                  }}
                >
                  Səhifə {page.pageNumber}
                  <span className="text-muted-foreground ml-auto text-xs tabular-nums">
                    {page.crops.length} sual
                  </span>
                  {needsAttention(page) ? (
                    <TriangleAlert className="text-destructive size-3.5" />
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

export function CropGrid({
  results,
  selection,
}: {
  results: PageResult[]
  selection?: CropSelection
}) {
  const [active, setActive] = useState<number | null>(null)
  const [filter, setFilter] = useState<PageFilter>('all')
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [pendingJump, setPendingJump] = useState<number | null>(null)
  const sectionRefs = useRef(new Map<number, HTMLElement>())

  // Scroll only AFTER the target section is committed — a jump may first have
  // to reset the filter and expand the section, so the ref does not exist yet
  // inside the click handler (or a rAF racing React's commit).
  useEffect(() => {
    if (pendingJump === null) return
    const el = sectionRefs.current.get(pendingJump)
    if (el) {
      // Instant, not smooth: a smooth sweep over a multi-thousand-px jump is
      // slow, and Chrome silently drops smooth scrollIntoView into
      // content-visibility:auto subtrees.
      el.scrollIntoView({ block: 'start' })
      el.focus({ preventScroll: true })
    }
    setPendingJump(null)
  }, [pendingJump])

  // One flat, ordered list across all pages, so the lightbox pages through
  // the entire run; offsets map a page's crops back into that list.
  const flat: FlatCrop[] = []
  const offsets = new Map<number, number>()
  for (const page of results) {
    offsets.set(page.pageNumber, flat.length)
    for (const crop of page.crops) flat.push({ crop, page })
  }

  const visible = results.filter((page) => matchesFilter(page, filter))
  const allCollapsed =
    visible.length > 0 && visible.every((p) => collapsed.has(p.pageNumber))

  function toggleSection(pageNumber: number) {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(pageNumber)) next.delete(pageNumber)
      else next.add(pageNumber)
      return next
    })
  }

  function toggleAll() {
    setCollapsed(
      allCollapsed ? new Set() : new Set(visible.map((p) => p.pageNumber)),
    )
  }

  function jumpTo(pageNumber: number) {
    // The target may be filtered out or folded — make it reachable first.
    const page = results.find((p) => p.pageNumber === pageNumber)
    if (page && !matchesFilter(page, filter)) setFilter('all')
    setCollapsed((current) => {
      const next = new Set(current)
      next.delete(pageNumber)
      return next
    })
    setPendingJump(pageNumber)
  }

  const attentionCount = results.filter(needsAttention).length
  const emptyCount = results.filter((p) => p.crops.length === 0).length
  const counts: Record<PageFilter, number> = {
    all: results.length,
    attention: attentionCount,
    empty: emptyCount,
  }

  return (
    <div className="bg-muted/30 flex flex-col gap-6 rounded-xl border p-4 sm:p-5">
      {results.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="Səhifə süzgəci"
            className="flex items-center gap-1"
          >
            {FILTERS.map((f) => (
              <Button
                key={f.key}
                size="sm"
                variant={filter === f.key ? 'secondary' : 'ghost'}
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
                <span className="text-muted-foreground tabular-nums">
                  {counts[f.key]}
                </span>
              </Button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <PageJump results={results} onJump={jumpTo} />
            <Button size="sm" variant="ghost" onClick={toggleAll}>
              {allCollapsed ? 'Hamısını aç' : 'Hamısını yığ'}
            </Button>
          </div>
        </div>
      ) : null}

      {visible.length === 0 ? (
        <p className="text-muted-foreground py-4 text-center text-sm">
          Bu süzgəcə uyğun səhifə yoxdur.
        </p>
      ) : null}

      {visible.map((page) => {
        const offset = offsets.get(page.pageNumber) ?? 0
        const notes = page.notes.filter((note) => note !== PATH_NOTE)
        const isCollapsed = collapsed.has(page.pageNumber)
        return (
          <section
            key={page.pageNumber}
            tabIndex={-1}
            ref={(el) => {
              if (el) sectionRefs.current.set(page.pageNumber, el)
              else sectionRefs.current.delete(page.pageNumber)
            }}
            // content-visibility: the browser skips layout/paint of offscreen
            // sections — "virtualization without JS" for long runs; the
            // intrinsic-size keeps the scrollbar stable while skipped.
            className="flex scroll-mt-2 flex-col gap-3 [contain-intrinsic-size:auto_460px] [content-visibility:auto]"
          >
            <div className="bg-background/80 sticky top-0 z-10 -mx-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border-b px-2 py-2 backdrop-blur-sm">
              <span
                aria-hidden
                className="bg-paper-rule h-4 w-0.5 rounded-full"
              />
              <h2 className="min-w-0">
                <button
                  type="button"
                  aria-expanded={!isCollapsed}
                  onClick={() => toggleSection(page.pageNumber)}
                  className="flex items-center gap-1.5 font-mono text-xs font-medium tracking-[0.14em] uppercase"
                >
                  <ChevronDown
                    className={cn(
                      'text-muted-foreground size-3.5 shrink-0 transition-transform',
                      isCollapsed && '-rotate-90',
                    )}
                  />
                  Səhifə {page.pageNumber}
                  {page.testNo !== undefined ? ` · Test ${page.testNo}` : ''}
                </button>
              </h2>
              <span className="text-muted-foreground text-xs tabular-nums">
                {page.crops.length} sual
              </span>
              <PathBadge page={page} />
            </div>

            {isCollapsed ? null : (
              <>

            {notes.map((note, i) => (
              // Notes can repeat verbatim across columns; the array is built
              // once per page and never reordered, so the index is a stable key.
              <p
                key={`${i}-${note}`}
                className={cn(
                  'flex items-start gap-1.5 text-xs',
                  isWarningNote(note)
                    ? 'bg-destructive/5 text-destructive rounded-md px-2.5 py-1.5'
                    : 'text-muted-foreground',
                )}
              >
                {isWarningNote(note) ? (
                  <TriangleAlert className="mt-px size-3.5 shrink-0" />
                ) : (
                  <Info className="mt-px size-3.5 shrink-0" />
                )}
                {note}
              </p>
            ))}

            {page.crops.length > 0 ? (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {page.crops.map((crop, i) => (
                  <CropCard
                    key={`${crop.col}-${crop.number}`}
                    crop={crop}
                    onOpen={() => setActive(offset + i)}
                    selectionKey={`p${crop.pageNumber}_c${crop.col}_q${crop.number}`}
                    selection={selection}
                  />
                ))}
              </div>
            ) : null}
              </>
            )}
          </section>
        )
      })}

      <CropLightbox
        items={flat}
        index={active}
        onNavigate={setActive}
        onClose={() => setActive(null)}
      />
    </div>
  )
}

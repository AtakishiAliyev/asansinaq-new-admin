import { useEffect, useMemo, useState } from 'react'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Pencil,
  RefreshCw,
  X,
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import { QuestionPreview } from '@/components/question/question-preview'
import { useCategories, type Category } from '@/features/taxonomy'
import {
  useApproveQuestion,
  useEditQuestion,
  useRejectQuestion,
  useSignedUrls,
  type QuestionListItem,
} from '@/features/questions/api/questions'
import { QuestionEditForm } from '@/features/questions/components/question-edit-form'
import {
  FlagBadges,
  VerifiedBadge,
} from '@/features/questions/components/question-diagnostics'
import {
  imagePathsOf,
  parseFigures,
  parseFlags,
  parseOptions,
} from '@/features/questions/lib/row'

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

// Keyboard-first review: original crop on the left, the recreation rendered
// with the SAME components production will use on the right. Approval writes
// to the DB before advancing — no silent local-only approvals.
export function ReviewScreen({
  items,
  index,
  subjectId,
  onIndexChange,
  onClose,
  onRestructure,
}: {
  items: QuestionListItem[]
  index: number
  subjectId: number | null
  onIndexChange: (index: number) => void
  onClose: () => void
  onRestructure: (item: QuestionListItem) => void
}) {
  const item = items[Math.min(index, items.length - 1)]
  const categories = useCategories(subjectId)
  const approve = useApproveQuestion()
  const reject = useRejectQuestion()
  const edit = useEditQuestion()
  const [editing, setEditing] = useState(false)
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [difficulty, setDifficulty] = useState<number | null>(null)

  const paths = useMemo(() => (item ? imagePathsOf(item) : []), [item])
  const signed = useSignedUrls(paths)
  const resolveImageUrl = (src: string) =>
    src.startsWith('data:') ? src : (signed.data?.get(src) ?? src)

  // Per-question review state: the AI suggestion pre-fills, the reviewer's
  // choice is what gets written.
  useEffect(() => {
    if (!item) return
    setCategoryId(item.category_id ?? item.ai_category_id ?? null)
    setDifficulty(item.reviewer_difficulty ?? item.ai_difficulty ?? null)
    setEditing(false)
  }, [item])

  const busy = approve.isPending || reject.isPending || edit.isPending
  const canApprove = Boolean(item && categoryId && item.status === 'structured')

  function next() {
    if (index < items.length - 1) onIndexChange(index + 1)
    else onClose()
  }

  function handleApprove() {
    if (!item || !categoryId || !canApprove) return
    approve.mutate(
      {
        id: item.id,
        categoryId,
        reviewerDifficulty: difficulty,
        answer: null,
        answerChanged: false,
      },
      { onSuccess: next },
    )
  }

  function handleReject() {
    if (!item) return
    reject.mutate({ id: item.id }, { onSuccess: next })
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (editing || busy) return
      const target = e.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return
      if (e.key === 'ArrowLeft' && index > 0) onIndexChange(index - 1)
      else if (e.key === 'ArrowRight' && index < items.length - 1)
        onIndexChange(index + 1)
      else if (e.key === 'a' || e.key === 'Enter') handleApprove()
      else if (e.key === 'd') handleReject()
      else if (e.key === 'e') setEditing(true)
      else return
      e.preventDefault()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  })

  if (!item) return null
  const flags = parseFlags(item.flags)
  const options = parseOptions(item.options)

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/60 p-3 sm:p-6">
      <div className="bg-background flex min-h-0 flex-1 flex-col gap-3 rounded-xl border p-4 shadow-lg">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-mono text-sm tracking-[0.14em] uppercase">
            {item.bookTitle ? `${item.bookTitle} · ` : ''}s.{item.page_number} · sual{' '}
            {item.q_no}
          </span>
          <VerifiedBadge verified={item.verified} />
          {item.status === 'failed' ? (
            <Badge
              variant="outline"
              className="border-destructive/30 bg-destructive/10 text-destructive"
            >
              alınmadı
            </Badge>
          ) : null}
          <span className="text-muted-foreground ml-auto text-sm tabular-nums">
            {index + 1} / {items.length}
          </span>
          <Button variant="ghost" size="icon-sm" aria-label="Bağla" onClick={onClose}>
            <X />
          </Button>
        </div>

        <div className="grid min-h-0 flex-1 gap-3 overflow-auto md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <p className="text-muted-foreground font-mono text-[11px] tracking-[0.14em] uppercase">
              Orijinal
            </p>
            <div className="rounded-md border bg-white p-2">
              {signed.data?.get(item.crop_path) ? (
                <img
                  src={signed.data.get(item.crop_path)}
                  alt="Orijinal crop"
                  className="w-full"
                />
              ) : (
                <div className="text-muted-foreground flex h-40 items-center justify-center text-sm">
                  {signed.isPending ? 'yüklənir…' : 'crop açıla bilmədi'}
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="text-muted-foreground font-mono text-[11px] tracking-[0.14em] uppercase">
              Yenidən yaradılmış
            </p>
            <div className="rounded-md border bg-white p-3">
              {item.stem ? (
                <QuestionPreview
                  question={{
                    stem: item.stem,
                    options,
                    figures: parseFigures(item.figures),
                  }}
                  resolveImageUrl={resolveImageUrl}
                />
              ) : (
                <p className="text-destructive text-sm">
                  {item.extraction_error ?? 'nəticə yoxdur'}
                </p>
              )}
            </div>
          </div>
        </div>

        <FlagBadges flags={flags} />

        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <CategoryPicker
            categories={categories.data ?? []}
            value={categoryId}
            onChange={setCategoryId}
            suggestion={item.ai_category_id}
          />
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground text-xs">Çətinlik:</span>
            {DIFFICULTIES.map((d) => (
              <Button
                key={d}
                size="icon-sm"
                variant={difficulty === d ? 'secondary' : 'ghost'}
                aria-pressed={difficulty === d}
                onClick={() => setDifficulty(d)}
              >
                {d}
              </Button>
            ))}
            {item.ai_difficulty ? (
              <span className="text-muted-foreground text-xs">
                (AI: {item.ai_difficulty})
              </span>
            ) : null}
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onRestructure(item)}
              disabled={busy}
            >
              <RefreshCw data-icon="inline-start" />
              Yenidən çıxar
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditing(true)}
              disabled={busy || !item.stem}
            >
              <Pencil data-icon="inline-start" />
              Redaktə (E)
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive"
              onClick={handleReject}
              disabled={busy}
            >
              <X data-icon="inline-start" />
              Rədd et (D)
            </Button>
            <Button size="sm" onClick={handleApprove} disabled={busy || !canApprove}>
              {approve.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <Check data-icon="inline-start" />
              )}
              Təsdiqlə (A)
            </Button>
          </div>
        </div>
        {!categoryId && item.status === 'structured' ? (
          <p className="text-muted-foreground text-xs">
            Təsdiq üçün kateqoriya seçilməlidir.
          </p>
        ) : null}

        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="icon"
            aria-label="Əvvəlki"
            aria-disabled={index <= 0}
            className={index <= 0 ? 'pointer-events-none opacity-50' : undefined}
            onClick={() => onIndexChange(index - 1)}
          >
            <ChevronLeft />
          </Button>
          <span className="text-muted-foreground text-xs">
            A = təsdiq · D = rədd · E = redaktə · ← → keçid
          </span>
          <Button
            variant="outline"
            size="icon"
            aria-label="Növbəti"
            aria-disabled={index >= items.length - 1}
            className={
              index >= items.length - 1 ? 'pointer-events-none opacity-50' : undefined
            }
            onClick={() => onIndexChange(index + 1)}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>

      {editing ? (
        <QuestionEditForm
          question={item}
          isPending={edit.isPending}
          onCancel={() => setEditing(false)}
          onSubmit={(values) =>
            edit.mutate(
              { id: item.id, ...values },
              { onSuccess: () => setEditing(false) },
            )
          }
        />
      ) : null}
    </div>
  )
}

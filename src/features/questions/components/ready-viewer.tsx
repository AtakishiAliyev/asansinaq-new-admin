import { useEffect, useMemo, useRef } from 'react'
import { ChevronLeft, ChevronRight, Undo2, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import type { Category } from '@/features/taxonomy'
import {
  useEditApproved,
  useSignedUrls,
  useUnapproveQuestion,
  type EditApprovedInput,
  type QuestionListItem,
} from '@/features/questions/api/questions'
import { ANSWERS } from '@/features/questions/components/review-actions'
import { CategoryPicker } from '@/features/questions/components/category-picker'
import { DIFFICULTY_LABEL, DIFFICULTY_LEVELS } from '@/core/questions/difficulty'
import {
  FlagBadges,
  VerifiedBadge,
} from '@/features/questions/components/question-diagnostics'
import { ReviewPanes } from '@/features/questions/components/review-panes'
import { imagePathsOf, parseFlags } from '@/features/questions/lib/row'

/** Neighbours pre-signed with the current item so arrows do not blank a pane. */
const WINDOW_BEHIND = 1
const WINDOW_AHEAD = 3

// Reading — and correcting — one finished question, beside the crop it came
// from.
//
// The review screen's twin, and deliberately not the same component. There the
// three fields are staged and written by the approval; here the row is already
// live, so each edit is its own write and lands the moment it is made.
//
// What this screen does NOT take from its twin is the letter keys. There, `A`
// approves and `1`–`5` set a difficulty, which is right for a queue somebody is
// working through on the keyboard. Here every row is published content, and a
// stray keypress that silently retypes a live question's answer is not a
// trade worth making for a saved click. The arrows navigate; everything else
// is deliberate.

/** One labelled control, matching the review screen's decision bar. */
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

export function ReadyViewer({
  items,
  index,
  categories,
  onNavigate,
  onClose,
}: {
  items: QuestionListItem[]
  index: number
  /** The OPEN row's own subject tree, so the picker is never empty. */
  categories: Category[]
  onNavigate: (id: number) => void
  onClose: () => void
}) {
  const item = index >= 0 ? items[index] : undefined
  const contentRef = useRef<HTMLDivElement>(null)
  const unapprove = useUnapproveQuestion()
  const edit = useEditApproved()
  const busy = edit.isPending || unapprove.isPending

  // Written the moment they change, not staged behind a save button. There is
  // no approve step here to carry the write, and a staged edit that a left
  // arrow throws away is worse than one more round trip.
  //
  // The patch carries ONLY the field that changed. Sending all three would make
  // the row's own state an input to every write, and two quick clicks would
  // then have the second one restore what the first had just replaced.
  function save(patch: Omit<EditApprovedInput, 'id'>) {
    if (!item) return
    edit.mutate({ id: item.id, ...patch })
  }

  const paths = useMemo(() => {
    if (index < 0) return []
    return items
      .slice(Math.max(0, index - WINDOW_BEHIND), index + WINDOW_AHEAD + 1)
      .flatMap(imagePathsOf)
  }, [items, index])
  const signed = useSignedUrls(paths)
  const resolveImageUrl = (src: string) =>
    src.startsWith('data:') ? src : (signed.data?.get(src) ?? src)

  // No dependency array, like the review screen's: the handler closes over
  // `index` and `items`, and a stale closure would walk from the wrong row.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!item) return
      const target = e.target as HTMLElement | null
      // The topic picker's search box is an input, and its own list is driven
      // by the same arrows — neither may move the catalogue underneath it.
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return
      if (target?.closest('button,[role="option"],[role="combobox"]')) return
      if (e.key === 'ArrowLeft' && index > 0) onNavigate(items[index - 1]!.id)
      else if (e.key === 'ArrowRight' && index < items.length - 1)
        onNavigate(items[index + 1]!.id)
      else return
      e.preventDefault()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  })

  if (!item) return null

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        ref={contentRef}
        showCloseButton={false}
        tabIndex={-1}
        className="flex h-[94vh] max-w-[96vw] flex-col gap-3 sm:max-w-[96vw]"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <DialogTitle className="font-mono text-sm tracking-[0.14em] uppercase">
            {item.bookTitle ? `${item.bookTitle} · ` : ''}s.{item.page_number} ·
            sual {item.q_no}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Təsdiqlənmiş sual, orijinal kəsimlə yan-yana. Sol və sağ ox
            düymələri ilə keçid, Escape bağlayır.
          </DialogDescription>
          <Badge
            variant="outline"
            className="border-emerald-200 bg-emerald-50 text-emerald-700"
          >
            təsdiqlənib
          </Badge>
          {item.auto_approved ? (
            <Badge
              variant="outline"
              className="text-muted-foreground"
              title="Bu sualı qayda təsdiqləyib — heç kim ayrıca baxmayıb."
            >
              avtomatik
            </Badge>
          ) : null}
          <VerifiedBadge verified={item.verified} />
          <span className="text-muted-foreground ml-auto text-sm tabular-nums">
            {index + 1} / {items.length}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Bağla"
            onClick={onClose}
          >
            <X />
          </Button>
        </div>

        <ReviewPanes
          item={item}
          cropUrl={signed.data?.get(item.crop_path)}
          isSigning={signed.isPending}
          resolveImageUrl={resolveImageUrl}
        />

        <FlagBadges flags={parseFlags(item.flags)} />

        {/* Same shape as the review screen's decision bar — the attributes in
            one group, the action pushed to the end — so a reviewer moving
            between the two screens is not reading a new layout. */}
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-t pt-3">
          <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
            <Field label="Mövzu">
              <CategoryPicker
                categories={categories}
                value={item.category_id}
                onChange={(categoryId) => save({ categoryId })}
              />
            </Field>

            <Field
              label="Cavab"
              hint={
                item.answer === null
                  ? undefined
                  : item.answer_source === 'reviewer'
                    ? 'əl ilə'
                    : item.answer_source === 'key'
                      ? 'açardan'
                      : undefined
              }
            >
              {ANSWERS.map((a) => (
                <Button
                  key={a}
                  size="icon-sm"
                  variant={item.answer === a ? 'secondary' : 'ghost'}
                  aria-pressed={item.answer === a}
                  aria-label={`Cavab ${a}`}
                  disabled={busy}
                  onClick={() => save({ answer: a })}
                >
                  {a}
                </Button>
              ))}
              {item.answer === null ? (
                <span className="ml-1 text-xs text-amber-700">yoxdur</span>
              ) : null}
            </Field>

            {/* Pressed on the EFFECTIVE level — the reviewer's where chosen,
                else the model's — because that is the value the bank shows.
                A click writes the reviewer's, which then becomes effective. */}
            <Field
              label="Çətinlik"
              hint={item.reviewer_difficulty === null ? 'AI-ın seçimi' : undefined}
            >
              {DIFFICULTY_LEVELS.map((d) => (
                <Button
                  key={d}
                  size="sm"
                  variant={item.difficulty === d ? 'secondary' : 'ghost'}
                  aria-pressed={item.difficulty === d}
                  disabled={busy}
                  onClick={() => save({ reviewerDifficulty: d })}
                >
                  {DIFFICULTY_LABEL[d]}
                </Button>
              ))}
            </Field>
          </div>

          {/* The one action that changes what the bank CONTAINS rather than
              what a row says: a question that should not be live goes back to
              review rather than being deleted from here. */}
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            disabled={busy}
            onClick={() => unapprove.mutate({ id: item.id })}
            title="Sual yenidən yoxlama siyahısına qayıdır — mövzusu, cavabı və çətinliyi saxlanılır"
          >
            {unapprove.isPending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <Undo2 data-icon="inline-start" />
            )}
            Təsdiqi geri al
          </Button>
        </div>

        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="icon"
            aria-label="Əvvəlki"
            aria-disabled={index <= 0}
            className={index <= 0 ? 'pointer-events-none opacity-50' : undefined}
            onClick={() => {
              const previous = items[index - 1]
              if (previous) onNavigate(previous.id)
            }}
          >
            <ChevronLeft />
          </Button>
          <span className="text-muted-foreground text-xs">← → keçid</span>
          <Button
            variant="outline"
            size="icon"
            aria-label="Növbəti"
            aria-disabled={index >= items.length - 1}
            className={
              index >= items.length - 1
                ? 'pointer-events-none opacity-50'
                : undefined
            }
            onClick={() => {
              const next = items[index + 1]
              if (next) onNavigate(next.id)
            }}
          >
            <ChevronRight />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

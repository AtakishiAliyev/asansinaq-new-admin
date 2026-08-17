import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { useCategories } from '@/features/taxonomy'
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
import { ReviewActions } from '@/features/questions/components/review-actions'
import { ReviewPanes } from '@/features/questions/components/review-panes'
import { imagePathsOf, parseFlags } from '@/features/questions/lib/row'

/** Neighbours pre-signed with the current item so arrows do not blank a pane. */
const WINDOW_BEHIND = 1
const WINDOW_AHEAD = 3

// Keyboard-first review: original crop on the left, the recreation rendered
// with the SAME components production will use on the right. Approval writes
// to the DB before advancing — no silent local-only approvals.
export function ReviewScreen({
  items,
  index,
  subjectId,
  onNavigate,
  onClose,
  onRestructure,
}: {
  items: QuestionListItem[]
  index: number
  subjectId: number | null
  onNavigate: (id: number) => void
  onClose: () => void
  onRestructure: (item: QuestionListItem) => void
}) {
  const item = index >= 0 ? items[index] : undefined
  const contentRef = useRef<HTMLDivElement>(null)
  const categories = useCategories(subjectId)
  const approve = useApproveQuestion()
  const reject = useRejectQuestion()
  const edit = useEditQuestion()
  const [editing, setEditing] = useState(false)
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [difficulty, setDifficulty] = useState<number | null>(null)

  // Sign a sliding window, not just this row: navigation then resolves from
  // the previous query's map instead of waiting on a fresh signing round-trip.
  const paths = useMemo(() => {
    if (index < 0) return []
    return items
      .slice(Math.max(0, index - WINDOW_BEHIND), index + WINDOW_AHEAD + 1)
      .flatMap(imagePathsOf)
  }, [items, index])
  const signed = useSignedUrls(paths)
  const resolveImageUrl = (src: string) =>
    src.startsWith('data:') ? src : (signed.data?.get(src) ?? src)

  // Per-question review state: the AI suggestion pre-fills, the reviewer's
  // choice is what gets written. Keyed on the id, not the row object — a
  // refetch after an edit hands back a new object and would wipe the picks.
  const itemId = item?.id
  useEffect(() => {
    const current = items.find((q) => q.id === itemId)
    if (!current) return
    setCategoryId(current.category_id ?? current.ai_category_id ?? null)
    setDifficulty(current.reviewer_difficulty ?? current.ai_difficulty ?? null)
    setEditing(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new question re-prefills
  }, [itemId])

  // The queue can empty under the reviewer (the last flagged row gets approved);
  // without this the overlay stays mounted, invisible, holding a stale cursor.
  useEffect(() => {
    if (!item) onClose()
  }, [item, onClose])

  const busy = approve.isPending || reject.isPending || edit.isPending
  const canApprove = Boolean(item && categoryId && item.status === 'structured')

  /** The id to land on after this row leaves the list — captured before the
   *  mutation, because the refetch reorders/removes rows under us. */
  function nextId(): number | null {
    return items[index + 1]?.id ?? null
  }

  function goTo(target: number | null) {
    if (target === null) onClose()
    else onNavigate(target)
  }

  function handleApprove() {
    if (!item || !categoryId || !canApprove) return
    const after = nextId()
    approve.mutate(
      {
        id: item.id,
        categoryId,
        reviewerDifficulty: difficulty,
        answer: null,
        answerChanged: false,
      },
      { onSuccess: () => goTo(after) },
    )
  }

  function handleReject() {
    if (!item) return
    const after = nextId()
    reject.mutate({ id: item.id }, { onSuccess: () => goTo(after) })
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!item || editing || busy) return
      const target = e.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return
      // A focused control owns its own Enter/Space; approving from under it
      // would fire two different actions from one keypress.
      if (target?.closest('button,[role="option"],[role="combobox"]')) return
      if (e.key === 'ArrowLeft' && index > 0) onNavigate(items[index - 1].id)
      else if (e.key === 'ArrowRight' && index < items.length - 1)
        onNavigate(items[index + 1].id)
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

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        ref={contentRef}
        showCloseButton={false}
        tabIndex={-1}
        // Focus the shell, not its first button: the shortcuts below are
        // deliberately inert while a control has focus.
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          contentRef.current?.focus()
        }}
        className="flex h-[94vh] max-w-[96vw] flex-col gap-3 sm:max-w-[96vw]"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <DialogTitle className="font-mono text-sm tracking-[0.14em] uppercase">
            {item.bookTitle ? `${item.bookTitle} · ` : ''}s.{item.page_number} · sual{' '}
            {item.q_no}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Klaviatura ilə yoxlama: A təsdiq, D rədd, E redaktə, sol/sağ ox
            düymələri ilə keçid. Escape pəncərəni bağlayır.
          </DialogDescription>
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

        <ReviewPanes
          item={item}
          cropUrl={signed.data?.get(item.crop_path)}
          isSigning={signed.isPending}
          resolveImageUrl={resolveImageUrl}
        />

        <FlagBadges flags={parseFlags(item.flags)} />

        <ReviewActions
          categories={categories.data ?? []}
          categoryId={categoryId}
          onCategoryChange={setCategoryId}
          suggestion={item.ai_category_id}
          aiDifficulty={item.ai_difficulty}
          difficulty={difficulty}
          onDifficultyChange={setDifficulty}
          busy={busy}
          canApprove={canApprove}
          canEdit={Boolean(item.stem)}
          isApproving={approve.isPending}
          onRestructure={() => onRestructure(item)}
          onEdit={() => setEditing(true)}
          onReject={handleReject}
          onApprove={handleApprove}
        />
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
            onClick={() => onNavigate(items[index - 1].id)}
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
            onClick={() => onNavigate(items[index + 1].id)}
          >
            <ChevronRight />
          </Button>
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
      </DialogContent>
    </Dialog>
  )
}

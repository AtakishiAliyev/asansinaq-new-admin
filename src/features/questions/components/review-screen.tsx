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
import { Spinner } from '@/components/ui/spinner'
import { useCategories } from '@/features/taxonomy'
import {
  useApproveQuestion,
  useEditFigures,
  useEditQuestion,
  useRejectQuestion,
  useSignedUrls,
  type QuestionListItem,
} from '@/features/questions/api/questions'
import { FigureEditorDialog } from '@/features/questions/components/figure-editor/figure-editor-dialog'
import { QuestionEditForm } from '@/features/questions/components/question-edit-form'
import {
  FlagBadges,
  VerifiedBadge,
} from '@/features/questions/components/question-diagnostics'
import { ReviewActions } from '@/features/questions/components/review-actions'
import { ReviewPanes } from '@/features/questions/components/review-panes'
import {
  imagePathsOf,
  parseFigures,
  parseFlags,
  parseOptions,
} from '@/features/questions/lib/row'

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
  hasNextPage,
  isAdvancing,
  onNextPage,
  onNavigate,
  onClose,
  onRestructure,
}: {
  items: QuestionListItem[]
  index: number
  subjectId: number | null
  /** more rows match the filter beyond this page */
  hasNextPage: boolean
  /** the next page is loading and this cursor is deliberately empty */
  isAdvancing: boolean
  onNextPage: () => void
  onNavigate: (id: number) => void
  onClose: () => void
  onRestructure: (item: QuestionListItem) => void
}) {
  const item = index >= 0 ? items[index] : undefined
  const figureDoc = parseFigures(item?.figures)
  // Only a geometry item is editable as data: it is the kind whose points,
  // edges and marks the editor understands. The first one, because a question
  // carrying two geometry figures has not been seen and guessing at a picker
  // for it would be UI nobody asked for.
  const figureIndex = figureDoc?.items.findIndex((f) => f.kind === 'geometry') ?? -1
  const contentRef = useRef<HTMLDivElement>(null)
  const categories = useCategories(subjectId)
  const approve = useApproveQuestion()
  const reject = useRejectQuestion()
  const edit = useEditQuestion()
  const editFigures = useEditFigures()
  const [editing, setEditing] = useState(false)
  const [editingFigure, setEditingFigure] = useState(false)
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [difficulty, setDifficulty] = useState<number | null>(null)
  const [answer, setAnswer] = useState<string | null>(null)
  // Only a reviewer's own pick is written back. A printed-key answer that was
  // merely displayed must not be rewritten as `answer_source = 'reviewer'`.
  const [answerChanged, setAnswerChanged] = useState(false)

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
    setAnswer(current.answer ?? null)
    setAnswerChanged(false)
    setEditing(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new question re-prefills
  }, [itemId])

  // The queue can empty under the reviewer (the last flagged row gets approved);
  // without this the overlay stays mounted, invisible, holding a stale cursor.
  // While a page turn is in flight the cursor is empty ON PURPOSE, so closing
  // then would end the session at every fiftieth question.
  useEffect(() => {
    if (!item && !isAdvancing) onClose()
  }, [item, isAdvancing, onClose])

  const busy = approve.isPending || reject.isPending || edit.isPending
  const canApprove = Boolean(item && categoryId && item.status === 'structured')

  /** The id to land on after this row leaves the list — captured before the
   *  mutation, because the refetch reorders/removes rows under us. */
  function nextId(): number | null {
    return items[index + 1]?.id ?? null
  }

  function goTo(target: number | null) {
    if (target !== null) onNavigate(target)
    // Reviewing a big book is one long session, not a hundred sessions of
    // fifty: at the end of a page, pull the next one instead of closing.
    else if (hasNextPage) onNextPage()
    else onClose()
  }

  function handleApprove() {
    if (!item || !categoryId || !canApprove) return
    const after = nextId()
    approve.mutate(
      {
        id: item.id,
        categoryId,
        reviewerDifficulty: difficulty,
        answer,
        answerChanged,
      },
      { onSuccess: () => goTo(after) },
    )
  }

  function chooseAnswer(next: string) {
    setAnswer(next)
    setAnswerChanged(true)
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
      // Case-folded so Caps Lock does not silently disable the shortcuts.
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
      // Shift+A…E picks the ANSWER; the same letters unshifted stay the
      // actions the reviewer already has in muscle memory.
      if (e.shiftKey && /^[a-e]$/.test(key)) chooseAnswer(key.toUpperCase())
      else if (/^[1-5]$/.test(key)) setDifficulty(Number(key))
      else if (e.key === 'ArrowLeft' && index > 0) onNavigate(items[index - 1]!.id)
      else if (e.key === 'ArrowRight' && index < items.length - 1)
        onNavigate(items[index + 1]!.id)
      else if (key === 'a' || key === 'Enter') handleApprove()
      else if (key === 'd') handleReject()
      else if (key === 'e') setEditing(true)
      else if (key === 'f' && figureIndex >= 0) setEditingFigure(true)
      else return
      e.preventDefault()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  })

  if (!item) {
    if (!isAdvancing) return null
    return (
      <Dialog open onOpenChange={(next) => !next && onClose()}>
        <DialogContent
          showCloseButton={false}
          className="flex h-[94vh] max-w-[96vw] items-center justify-center sm:max-w-[96vw]"
        >
          <DialogTitle className="sr-only">Növbəti səhifə yüklənir</DialogTitle>
          <DialogDescription className="sr-only">
            Növbəti sual dəsti gətirilir.
          </DialogDescription>
          <Spinner />
        </DialogContent>
      </Dialog>
    )
  }

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
            Klaviatura ilə yoxlama: A təsdiq, D rədd, E redaktə, Shift və A–E
            ilə cavab seçimi, 1–5 çətinlik, sol/sağ ox düymələri ilə keçid.
            Escape pəncərəni bağlayır.
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
          answer={answer}
          answerSource={answerChanged ? 'reviewer' : item.answer_source}
          onAnswerChange={chooseAnswer}
          busy={busy}
          canApprove={canApprove}
          // Anything past the crop stage is editable. Gating on `stem` locked
          // the editor on exactly the rows that needed it: a figure question
          // with no printed stem, and a failed read the operator wanted to type
          // in by hand.
          canEdit={item.status !== 'cropped'}
          canEditFigure={figureIndex >= 0}
          isApproving={approve.isPending}
          onRestructure={() => onRestructure(item)}
          onEdit={() => setEditing(true)}
          onEditFigure={() => setEditingFigure(true)}
          onReject={handleReject}
          onApprove={handleApprove}
        />
        {!categoryId && item.status === 'structured' ? (
          <p className="text-muted-foreground text-xs">
            Təsdiq üçün kateqoriya seçilməlidir.
          </p>
        ) : null}
        {answer === null && item.status === 'structured' ? (
          <p className="text-xs text-amber-700">
            Cavab yoxdur — cavab açarını idxal edin və ya Shift+A…E ilə seçin.
            Cavabsız sual bankda istifadə oluna bilməz.
          </p>
        ) : null}

        {/* `aria-disabled` rather than `disabled` keeps both arrows in the tab
            order, which also means the keyboard can still activate them at the
            edges — `pointer-events-none` only stops the mouse. So the handlers
            check the bound themselves; without that, Enter on the focused
            arrow at either end reads past the list and throws. */}
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
          <span className="text-muted-foreground text-xs">
            A = təsdiq · D = rədd · E = redaktə · F = fiqur · Shift+A…E = cavab ·
            1–5 = çətinlik · ← → keçid
          </span>
          <Button
            variant="outline"
            size="icon"
            aria-label="Növbəti"
            aria-disabled={index >= items.length - 1}
            className={
              index >= items.length - 1 ? 'pointer-events-none opacity-50' : undefined
            }
            onClick={() => {
              const next = items[index + 1]
              if (next) onNavigate(next.id)
            }}
          >
            <ChevronRight />
          </Button>
        </div>

        {editingFigure ? (
          <FigureEditorDialog
            open
            onOpenChange={setEditingFigure}
            doc={figureDoc}
            itemIndex={figureIndex}
            question={{ stem: item.stem, options: parseOptions(item.options) }}
            qNo={item.q_no}
            isPending={editFigures.isPending}
            onSave={(figures) =>
              editFigures.mutate(
                {
                  id: item.id,
                  figures,
                  question: { stem: item.stem, options: parseOptions(item.options) },
                  qNo: item.q_no,
                  flags: parseFlags(item.flags),
                },
                { onSuccess: () => setEditingFigure(false) },
              )
            }
          />
        ) : null}

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

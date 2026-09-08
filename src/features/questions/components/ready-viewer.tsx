import { useMemo, useRef } from 'react'
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
import {
  useSignedUrls,
  useUnapproveQuestion,
  type QuestionListItem,
} from '@/features/questions/api/questions'
import {
  FlagBadges,
  VerifiedBadge,
} from '@/features/questions/components/question-diagnostics'
import { ReviewPanes } from '@/features/questions/components/review-panes'
import { imagePathsOf, parseFlags } from '@/features/questions/lib/row'

/** Neighbours pre-signed with the current item so arrows do not blank a pane. */
const WINDOW_BEHIND = 1
const WINDOW_AHEAD = 3

// Reading one finished question, side by side with the crop it came from.
//
// The review screen's twin, and deliberately not the same component: this one
// has a single action, and that action is an escape hatch rather than part of
// a flow. A reviewer here is checking a question that is already live, not
// deciding one — so there is no category picker, no answer picker, no
// difficulty row and no approve key, and the arrows walk the catalogue rather
// than a queue that empties under them.
export function ReadyViewer({
  items,
  index,
  categoryName,
  onNavigate,
  onClose,
}: {
  items: QuestionListItem[]
  index: number
  categoryName: (id: number | null) => string
  onNavigate: (id: number) => void
  onClose: () => void
}) {
  const item = index >= 0 ? items[index] : undefined
  const contentRef = useRef<HTMLDivElement>(null)
  const unapprove = useUnapproveQuestion()

  const paths = useMemo(() => {
    if (index < 0) return []
    return items
      .slice(Math.max(0, index - WINDOW_BEHIND), index + WINDOW_AHEAD + 1)
      .flatMap(imagePathsOf)
  }, [items, index])
  const signed = useSignedUrls(paths)
  const resolveImageUrl = (src: string) =>
    src.startsWith('data:') ? src : (signed.data?.get(src) ?? src)

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

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3 text-sm">
          <span>
            <span className="text-muted-foreground">Mövzu: </span>
            {categoryName(item.category_id)}
          </span>
          <span>
            <span className="text-muted-foreground">Çətinlik: </span>
            {item.reviewer_difficulty ?? '—'}
          </span>
          <span>
            <span className="text-muted-foreground">Cavab: </span>
            {item.answer ?? '—'}
            {item.answer ? (
              <span className="text-muted-foreground text-xs">
                {item.answer_source === 'reviewer'
                  ? ' (əl ilə)'
                  : item.answer_source === 'key'
                    ? ' (açardan)'
                    : ''}
              </span>
            ) : null}
          </span>

          {/* The only write on this screen, and it is an escape hatch: a
              question that should not be live goes back to review rather than
              being edited here or deleted. */}
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            disabled={unapprove.isPending}
            onClick={() => unapprove.mutate({ id: item.id })}
            title="Sual yenidən yoxlama siyahısına qayıdır — kateqoriyası, cavabı və çətinliyi saxlanılır"
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

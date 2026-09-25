import { useSortable } from '@dnd-kit/sortable'
import { AlertTriangle, Eye, GripVertical, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StemText } from '@/components/question/tex'
import { cn } from '@/lib/utils'
import type { BuilderQuestion } from '@/features/exams/schemas'
import { DifficultyDot } from '@/features/exams/components/builder/difficulty-badge'

// One filled slot. Draggable by its handle only, so the buttons and the text
// stay clickable, and the keyboard can pick it up too (space, arrows, space).
export function SortableSlot({
  question,
  number,
  topicName,
  swapping,
  onPreview,
  onSwap,
  onRemove,
}: {
  question: BuilderQuestion
  number: number
  topicName: string
  swapping: boolean
  onPreview: () => void
  onSwap: () => void
  onRemove: () => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: question.id })

  const blocked =
    question.status !== undefined && question.status !== 'approved'
  const noAnswer = !question.answer

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: transform
          ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
          : undefined,
        transition,
      }}
      className={cn(
        'bg-background group flex items-start gap-2 rounded-md border px-2 py-2 text-sm',
        isDragging && 'relative z-10 shadow-lg',
        (blocked || noAnswer) && 'border-destructive/50',
      )}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        aria-label={`${number}-ci sualı sürüşdür`}
        className="text-muted-foreground hover:text-foreground mt-0.5 cursor-grab touch-none rounded p-0.5 active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>
      <span className="text-muted-foreground mt-0.5 w-5 shrink-0 text-right text-xs tabular-nums">
        {number}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="line-clamp-2 text-[13px] leading-snug [&_.katex]:text-[1em]">
          {question.stem.trim() ? (
            <StemText text={question.stem} />
          ) : (
            <span className="text-muted-foreground italic">şəkilli sual</span>
          )}
        </div>
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
          <DifficultyDot value={question.difficulty} />
          <span className="truncate">{topicName}</span>
          {question.usageCount > 0 ? (
            <span className="text-amber-700 dark:text-amber-400">
              {question.usageCount} denemədə
            </span>
          ) : null}
          {question.changedSincePublish ? (
            <span className="text-sky-700 dark:text-sky-400">
              bankda dəyişib
            </span>
          ) : null}
          {blocked ? (
            <span className="text-destructive inline-flex items-center gap-0.5">
              <AlertTriangle className="size-3" /> təsdiqlənməyib
            </span>
          ) : noAnswer ? (
            <span className="text-destructive inline-flex items-center gap-0.5">
              <AlertTriangle className="size-3" /> cavab yoxdur
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label="Bax"
          onClick={onPreview}
        >
          <Eye className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label="Eyni mövzu və çətinlikdən başqa sualla dəyiş"
          title="Eyni mövzu və çətinlikdən başqa sualla dəyiş"
          disabled={swapping}
          onClick={onSwap}
        >
          <RefreshCw className={cn('size-3.5', swapping && 'animate-spin')} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label="Çıxar"
          onClick={onRemove}
        >
          <X className="size-3.5" />
        </Button>
      </div>
    </li>
  )
}

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { cn } from '@/lib/utils'
import type { BuilderQuestion } from '@/features/exams/schemas'
import { Composition } from '@/features/exams/components/builder/composition'
import { SortableSlot } from '@/features/exams/components/builder/sortable-slot'

// One section of the exam: its fill, its make-up, and its questions in the
// order a student will meet them. Only the section being filled is open —
// the search on the left is scoped to its subject, and forty open slots of a
// section nobody is working on is forty rows of scrolling.
export function SectionBlock({
  position,
  subjectName,
  questions,
  capacity,
  isActive,
  numberOffset,
  topicName,
  topicCount,
  swappingId,
  onActivate,
  onMove,
  onRemove,
  onPreview,
  onSwap,
}: {
  position: number
  subjectName: string
  questions: BuilderQuestion[]
  capacity: number
  isActive: boolean
  /** Questions in the sections before this one, so numbering runs on. */
  numberOffset: number
  topicName: (id: number | null) => string
  topicCount: number
  swappingId: number | null
  onActivate: () => void
  onMove: (from: number, to: number) => void
  onRemove: (questionId: number) => void
  onPreview: (q: BuilderQuestion) => void
  onSwap: (q: BuilderQuestion) => void
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )
  const filled = questions.length
  const full = filled >= capacity

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const from = questions.findIndex((q) => q.id === active.id)
    const to = questions.findIndex((q) => q.id === over.id)
    if (from >= 0 && to >= 0) onMove(from, to)
  }

  return (
    <section
      className={cn(
        'rounded-lg border',
        isActive ? 'border-primary/50 bg-primary/[0.02]' : 'bg-muted/20',
      )}
    >
      <button
        type="button"
        onClick={onActivate}
        aria-expanded={isActive}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
      >
        <span className="bg-muted text-muted-foreground grid size-5 shrink-0 place-items-center rounded text-[11px] font-semibold">
          {position}
        </span>
        <span className="flex-1 text-sm font-medium">{subjectName}</span>
        <span
          className={cn(
            'text-xs tabular-nums',
            full
              ? 'text-emerald-700 dark:text-emerald-400'
              : 'text-muted-foreground',
          )}
        >
          {filled} / {capacity}
        </span>
      </button>
      <div
        className="bg-muted mx-3 mb-2.5 h-1 overflow-hidden rounded-full"
        aria-hidden
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width]',
            full ? 'bg-emerald-600' : 'bg-primary',
          )}
          style={{
            width: `${capacity ? Math.min(100, (filled / capacity) * 100) : 0}%`,
          }}
        />
      </div>

      {isActive ? (
        <div className="flex flex-col gap-3 px-3 pb-3">
          {filled > 0 ? (
            <Composition
              questions={questions}
              capacity={capacity}
              topicName={topicName}
              topicCount={topicCount}
            />
          ) : null}

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={questions.map((q) => q.id)}
              strategy={verticalListSortingStrategy}
            >
              <ol className="flex flex-col gap-1.5">
                {questions.map((q, i) => (
                  <SortableSlot
                    key={q.id}
                    question={q}
                    number={numberOffset + i + 1}
                    topicName={topicName(q.categoryId)}
                    swapping={swappingId === q.id}
                    onPreview={() => onPreview(q)}
                    onSwap={() => onSwap(q)}
                    onRemove={() => onRemove(q.id)}
                  />
                ))}
              </ol>
            </SortableContext>
          </DndContext>

          {!full ? (
            <p className="text-muted-foreground rounded-md border border-dashed px-3 py-3 text-center text-xs">
              {capacity - filled} boş yer qalıb. Soldakı siyahıdan əlavə edin və
              ya avtomatik doldurun.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

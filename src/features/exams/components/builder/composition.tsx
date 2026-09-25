import {
  DIFFICULTY_LABEL,
  DIFFICULTY_LEVELS,
} from '@/core/questions/difficulty'
import { cn } from '@/lib/utils'
import type { BuilderQuestion } from '@/features/exams/schemas'
import { DIFFICULTY_TONE } from '@/features/exams/lib/difficulty-tone'

// What a section is made of, read at a glance: the difficulty mix as one
// bar, and which topics it covers. It is what an admin checks before
// publishing and what a recipe is judged against, so it sits on the section
// itself rather than in a dialog.
export function Composition({
  questions,
  capacity,
  topicName,
  topicCount,
}: {
  questions: BuilderQuestion[]
  capacity: number
  topicName: (id: number | null) => string
  /** Topics the subject has, for "covered 8 of 12". */
  topicCount: number
}) {
  const byDifficulty = new Map<number, number>()
  const byTopic = new Map<number, number>()
  for (const q of questions) {
    if (q.difficulty)
      byDifficulty.set(q.difficulty, (byDifficulty.get(q.difficulty) ?? 0) + 1)
    if (q.categoryId)
      byTopic.set(q.categoryId, (byTopic.get(q.categoryId) ?? 0) + 1)
  }
  const topics = [...byTopic.entries()].sort((a, b) => b[1] - a[1])

  return (
    <div className="flex flex-col gap-2.5 text-xs">
      <div>
        <div
          className="bg-muted flex h-2 overflow-hidden rounded-full"
          aria-hidden
        >
          {DIFFICULTY_LEVELS.map((d) => {
            const n = byDifficulty.get(d) ?? 0
            return n ? (
              <div
                key={d}
                className={cn(DIFFICULTY_TONE[d])}
                style={{ width: `${(n / capacity) * 100}%` }}
              />
            ) : null
          })}
        </div>
        <div className="text-muted-foreground mt-1.5 flex gap-3">
          {DIFFICULTY_LEVELS.map((d) => (
            <span key={d} className="inline-flex items-center gap-1">
              <span className={cn('size-2 rounded-full', DIFFICULTY_TONE[d])} />
              {DIFFICULTY_LABEL[d]}{' '}
              <span className="text-foreground tabular-nums">
                {byDifficulty.get(d) ?? 0}
              </span>
            </span>
          ))}
        </div>
      </div>
      <div>
        <p className="text-muted-foreground mb-1">
          Mövzular:{' '}
          <span className="text-foreground tabular-nums">{byTopic.size}</span> /{' '}
          {topicCount}
        </p>
        {topics.length ? (
          <div className="flex flex-wrap gap-1">
            {topics.map(([id, n]) => (
              <span key={id} className="bg-muted rounded px-1.5 py-0.5">
                {topicName(id)}{' '}
                <span className="text-muted-foreground tabular-nums">{n}</span>
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

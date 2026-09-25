import { difficultyLabel } from '@/core/questions/difficulty'
import { cn } from '@/lib/utils'
import { DIFFICULTY_TONE } from '@/features/exams/lib/difficulty-tone'

export function DifficultyDot({ value }: { value: number | null }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-2 shrink-0 rounded-full',
        value ? DIFFICULTY_TONE[value] : 'bg-muted-foreground/40',
      )}
    />
  )
}

export function DifficultyTag({ value }: { value: number | null }) {
  return (
    <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
      <DifficultyDot value={value} />
      {difficultyLabel(value)}
    </span>
  )
}

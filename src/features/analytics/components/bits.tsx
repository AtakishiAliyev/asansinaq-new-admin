import { cn } from '@/lib/utils'
import { pct } from '@/features/analytics/lib/format'

// The small vocabulary every analytics screen shares: a figure with its
// label, a share bar, and the formatters — so a percentage looks the same
// on the dashboard, in a question's viewer and on a deneme's page.

export function Stat({
  label,
  value,
  hint,
  tone,
  className,
}: {
  label: string
  value: string
  hint?: string
  tone?: 'ok' | 'bad' | 'muted'
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      <span className="text-muted-foreground font-mono text-[11px] tracking-[0.14em] uppercase">
        {label}
      </span>
      <span
        className={cn(
          'text-2xl font-semibold tracking-tight tabular-nums',
          tone === 'ok' && 'text-emerald-700',
          tone === 'bad' && 'text-red-700',
          tone === 'muted' && 'text-muted-foreground',
        )}
      >
        {value}
      </span>
      {hint ? (
        <span className="text-muted-foreground text-xs">{hint}</span>
      ) : null}
    </div>
  )
}

/** Correct / wrong / blank as one bar. Legend carries the numbers. */
export function ShareBar({
  correct,
  wrong,
  blank,
  className,
  compact = false,
}: {
  correct: number
  wrong: number
  blank: number
  className?: string
  compact?: boolean
}) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div
        aria-hidden
        className={cn(
          'bg-muted flex w-full gap-px overflow-hidden rounded-full',
          compact ? 'h-1.5' : 'h-2.5',
        )}
      >
        <span
          className="h-full bg-emerald-500"
          style={{ width: `${correct}%` }}
        />
        <span className="h-full bg-red-500" style={{ width: `${wrong}%` }} />
        <span
          className="h-full bg-zinc-400/60"
          style={{ width: `${blank}%` }}
        />
      </div>
      {compact ? null : (
        <div className="text-muted-foreground flex gap-3 text-xs tabular-nums">
          <span>
            <span className="text-emerald-700">●</span> doğru {pct(correct)}
          </span>
          <span>
            <span className="text-red-700">●</span> səhv {pct(wrong)}
          </span>
          <span>
            <span className="text-zinc-500">●</span> boş {pct(blank)}
          </span>
        </div>
      )}
    </div>
  )
}

/** A–E (and blank) as five small bars, the key marked. */
export function ChoiceBars({
  choices,
  answer,
  className,
}: {
  choices: Record<string, number>
  answer: string | null
  className?: string
}) {
  const labels = ['A', 'B', 'C', 'D', 'E', '-']
  const total = Object.values(choices).reduce((s, n) => s + n, 0) || 1
  return (
    <div
      className={cn('flex items-end gap-1', className)}
      aria-label="Cavab paylanması"
    >
      {labels.map((l) => {
        const n = choices[l] ?? 0
        const share = n / total
        const isKey = l === answer
        return (
          <div
            key={l}
            className="flex w-6 flex-col items-center gap-0.5"
            title={`${l === '-' ? 'boş' : l}: ${n} (${Math.round(share * 100)}%)`}
          >
            <div className="bg-muted flex h-9 w-full items-end overflow-hidden rounded-sm">
              <span
                className={cn(
                  'w-full',
                  isKey
                    ? 'bg-emerald-500'
                    : l === '-'
                      ? 'bg-zinc-400/60'
                      : 'bg-red-400',
                )}
                style={{ height: `${Math.round(share * 100)}%` }}
              />
            </div>
            <span
              className={cn(
                'text-[10px] tabular-nums',
                isKey
                  ? 'font-semibold text-emerald-700'
                  : 'text-muted-foreground',
              )}
            >
              {l === '-' ? '∅' : l}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** The judgement a number carries, written once. */
export function SuspiciousBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800',
        className,
      )}
      title="Ən azı 10 cəhd, dörddə birdən az doğru, və cavablayanların yarısı eyni yanlış variantı seçib — açar yanlış ola bilər."
    >
      şübhəli açar
    </span>
  )
}

import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { TopicTotals } from '@/features/dashboard/api/bank-by-topic'

export interface TopicRow {
  id: number
  name: string
  totals: TopicTotals | undefined
}

/** How many empty tiles are shown before the rest fold into one. */
const EMPTY_SHOWN = 10

// The bank as a map: one tile per topic, the count inside, a thin strip along
// the bottom for the approved share. Filled tiles are tinted; empty ones are
// dashed outlines, because the map exists to show where the bank is thin and
// an empty topic that vanished would hide exactly that. Past ten of them the
// rest fold into one tile with a count, so a subject with forty empty topics
// does not push the filled ones off the screen.
export function TopicMap({ topics }: { topics: TopicRow[] }) {
  const [showAll, setShowAll] = useState(false)
  const filled = topics.filter((t) => (t.totals?.total ?? 0) > 0)
  const empty = topics.filter((t) => (t.totals?.total ?? 0) === 0)
  const visibleEmpty = showAll ? empty : empty.slice(0, EMPTY_SHOWN)
  const folded = empty.length - visibleEmpty.length

  return (
    <div className="flex flex-col gap-2">
      <div className="text-muted-foreground flex flex-wrap items-center gap-4 text-xs" aria-label="Şərti işarələr">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block size-2.5 rounded-[2px] border border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950" />
          sualı olan mövzu · alt zolaq təsdiq payı
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="border-border inline-block size-2.5 rounded-[2px] border border-dashed" />
          boş mövzu
        </span>
      </div>
      <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {filled.map((t) => {
          const total = t.totals!.total
          const approved = t.totals!.approved
          const share = Math.round((100 * approved) / total)
          return (
            <li
              key={t.id}
              title={`${t.name}: ${total} sual · ${approved} təsdiqlənib · ${t.totals!.books} kitab`}
              className="flex min-h-16 flex-col justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-2 dark:border-emerald-900 dark:bg-emerald-950/60"
            >
              <span className="line-clamp-2 text-xs leading-tight">{t.name}</span>
              <span>
                <span className="text-base font-medium tabular-nums">{total}</span>
                <span className="bg-border mt-1.5 block h-[3px] overflow-hidden rounded-full">
                  <span
                    aria-hidden
                    className="block h-full bg-emerald-600 dark:bg-emerald-500"
                    style={{ width: `${share}%` }}
                  />
                </span>
              </span>
            </li>
          )
        })}
        {visibleEmpty.map((t) => (
          <li
            key={t.id}
            title={`${t.name}: sual yoxdur`}
            className="border-border text-muted-foreground flex min-h-16 flex-col justify-between rounded-lg border border-dashed px-2.5 py-2"
          >
            <span className="line-clamp-2 text-xs leading-tight">{t.name}</span>
            <span className="text-base tabular-nums">—</span>
          </li>
        ))}
        {folded > 0 ? (
          <li className="min-h-16">
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className={cn(
                'border-border text-muted-foreground hover:bg-muted flex h-full w-full items-center justify-center rounded-lg border border-dashed px-2 text-xs',
                'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
              )}
            >
              +{folded} boş mövzu
            </button>
          </li>
        ) : null}
      </ul>
    </div>
  )
}

import { useState } from 'react'
import { ListEnd, Settings2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { useClearQueue, useThroughput } from '@/features/questions/api/queue'
import { PipelineSettingsDialog } from '@/features/questions/components/pipeline-settings-dialog'

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: string | number
  tone?: 'muted' | 'good' | 'bad'
}) {
  return (
    <div className="flex flex-col">
      <span
        className={cn(
          'text-lg leading-tight font-semibold tabular-nums',
          tone === 'good' && 'text-emerald-700',
          tone === 'bad' && 'text-destructive',
          tone === 'muted' && 'text-muted-foreground',
        )}
      >
        {value}
      </span>
      <span className="text-muted-foreground text-[11px] tracking-wide uppercase">
        {label}
      </span>
    </div>
  )
}

function formatEta(hours: number): string {
  if (hours < 1) return `~${Math.max(1, Math.round(hours * 60))} dəq`
  if (hours < 24) return `~${hours.toFixed(hours < 10 ? 1 : 0)} saat`
  return `~${(hours / 24).toFixed(1)} gün`
}

// What the queue is doing, read from the database rather than from this tab.
//
// There is no start button any more. Draining the queue is `worker/`'s job —
// a separate process, usually on another machine — so this page is a window
// onto shared state, not a control surface for a run it owns. Every number
// here is what a second operator would see at the same moment, which is the
// point: the browser used to be the worker, and a panel that reported its own
// tab's progress said nothing about the work anyone else was doing.
export function QueuePanel() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const stats = useThroughput()
  const clear = useClearQueue()
  const queued = stats.data?.queued ?? 0
  const running = stats.data?.running ?? 0
  const inBatch = stats.data?.in_batch ?? 0

  // What the operator actually needs from a job measured in days: when it ends.
  // Derived from the last hour's real throughput, so it already accounts for
  // cache hits, retries and whatever pace the provider is allowing.
  const perHour = stats.data?.structured_hour ?? 0
  const eta = queued && perHour ? formatEta(queued / perHour) : null

  return (
    <div className="bg-card flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
        <Stat label="növbədə" value={queued} tone={queued ? undefined : 'muted'} />
        <Stat label="son saat" value={stats.data?.structured_hour ?? '—'} />
        <Stat
          label="qalan vaxt"
          value={eta ?? '—'}
          tone={eta ? undefined : 'muted'}
        />
        <Stat label="işləyir" value={running || '—'} tone="muted" />
        <Stat label="bu gün" value={stats.data?.structured_today ?? '—'} />
        <Stat
          label="avtomatik təsdiq"
          value={stats.data?.auto_approved_today ?? '—'}
          tone="good"
        />
        <Stat
          label="xəta (bu gün)"
          value={stats.data?.failed_today ?? '—'}
          tone={stats.data?.failed_today ? 'bad' : 'muted'}
        />
        <Stat
          label="xərc (bu gün)"
          value={`$${(stats.data?.spend_today ?? 0).toFixed(2)}`}
        />

        <div className="ml-auto flex items-center gap-2">
          {queued && !running ? (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              disabled={clear.isPending}
              onClick={() => clear.mutate()}
              title="Növbədən çıxarır — worker-in tutduğu sətirlərə toxunmur"
            >
              <Trash2 data-icon="inline-start" />
              Boşalt
            </Button>
          ) : null}
          <Button
            size="icon"
            variant="ghost"
            aria-label="Emal parametrləri"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 />
          </Button>
        </div>
      </div>

      {inBatch ? (
        // Said out loud because it is the one state that looks broken and is
        // not: a batch answers in minutes or in hours, and nothing moves while
        // it does.
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <Spinner className="size-3.5" />
          {inBatch} sual provayderdə emal olunur — toplu sorğu bir neçə dəqiqədən
          bir neçə saata qədər çəkə bilər, bu müddətdə say dəyişmir.
        </p>
      ) : running ? (
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <Spinner className="size-3.5" />
          {running} sual worker tərəfindən hazırlanır.
        </p>
      ) : queued ? (
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <ListEnd className="size-3.5" />
          {queued} sual gözləyir. Növbə bazadadır — worker işə düşəndə götürəcək;
          bu tabın açıq qalmasına ehtiyac yoxdur.
        </p>
      ) : null}

      {settingsOpen ? (
        <PipelineSettingsDialog onClose={() => setSettingsOpen(false)} />
      ) : null}
    </div>
  )
}

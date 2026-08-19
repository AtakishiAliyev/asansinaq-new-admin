import { useEffect, useState } from 'react'
import {
  CircleAlert,
  ListEnd,
  Play,
  Settings2,
  Square,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { useClearQueue, useThroughput } from '@/features/questions/api/queue'
import { PipelineSettingsDialog } from '@/features/questions/components/pipeline-settings-dialog'
import { useQueueWorker } from '@/features/questions/hooks/use-queue-worker'
import { gateStatus } from '@/features/questions/lib/rate-gate'

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

// The operator's control room for a job measured in days, not seconds: what
// is left, how fast it is going, what it costs, and one switch to run it.
export function QueuePanel() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const worker = useQueueWorker()
  const isRunning = worker.status === 'running'
  const stats = useThroughput(isRunning)
  const clear = useClearQueue()
  const queued = stats.data?.queued ?? 0
  const batch = worker.batch

  // What the operator actually needs from a job measured in days: when it ends.
  // Derived from the last hour's real throughput, so it already accounts for
  // cache hits, retries and whatever pace the providers are allowing.
  const perHour = stats.data?.structured_hour ?? 0
  const eta = queued && perHour ? formatEta(queued / perHour) : null

  // How many model calls are actually in flight. The queue counts questions,
  // which is not the same thing — one question is several calls — and without
  // this there is no way to tell a working fleet from a stalled one.
  const [gate, setGate] = useState(gateStatus)
  useEffect(() => {
    if (!isRunning) return
    const id = setInterval(() => setGate(gateStatus()), 1000)
    return () => clearInterval(id)
  }, [isRunning])

  return (
    <div className="bg-card flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
        <Stat
          label="növbədə"
          value={queued}
          tone={queued ? undefined : 'muted'}
        />
        <Stat label="son saat" value={stats.data?.structured_hour ?? '—'} />
        <Stat
          label="qalan vaxt"
          value={eta ?? '—'}
          tone={eta ? undefined : 'muted'}
        />
        <Stat label="işləyir" value={stats.data?.running ?? '—'} tone="muted" />
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
          {isRunning ? (
            <Button size="sm" variant="outline" onClick={worker.stop}>
              <Square data-icon="inline-start" />
              Dayandır
            </Button>
          ) : (
            <Button size="sm" disabled={!queued} onClick={() => void worker.start()}>
              <Play data-icon="inline-start" />
              Növbəni işlət
            </Button>
          )}
          {queued && !isRunning ? (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              disabled={clear.isPending}
              onClick={() => clear.mutate()}
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

      {isRunning ? (
        <div className="flex items-center gap-3">
          <Progress
            value={(batch.current / Math.max(1, batch.total)) * 100}
            className="h-1.5 flex-1"
          />
          <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
            <Spinner data-icon="inline-start" className="inline" />
            paket {batch.current}/{batch.total} · mətn {gate.text.inFlight}/
            {gate.text.ceiling} · şəkil {gate.image.inFlight}/{gate.image.ceiling}
            {gate.text.waiting + gate.image.waiting > 0
              ? ` · ${gate.text.waiting + gate.image.waiting} gözləyir`
              : ''}
            {' · '}bu sessiyada {worker.processed}
            {worker.approved ? ` · ${worker.approved} avto-təsdiq` : ''}
            {worker.failed ? ` · ${worker.failed} xəta` : ''}
          </span>
        </div>
      ) : queued ? (
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <ListEnd className="size-3.5" />
          {queued} sual gözləyir. Növbə bazada saxlanılır: tab bağlansa da,
          başqa səhifəyə keçsəniz də iş itmir — buraya qayıdıb davam edirsiniz.
        </p>
      ) : null}

      {worker.error ? (
        <p className="text-destructive flex items-center gap-1.5 text-xs">
          <CircleAlert className="size-3.5" />
          {worker.error}
        </p>
      ) : null}

      {settingsOpen ? (
        <PipelineSettingsDialog onClose={() => setSettingsOpen(false)} />
      ) : null}
    </div>
  )
}

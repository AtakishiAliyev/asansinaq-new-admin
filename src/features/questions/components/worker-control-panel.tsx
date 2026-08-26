import { CircleDot, Pause, Play, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  useSetWorkerState,
  useWorkerStatus,
  type WorkerStatus,
} from '@/features/questions/api/worker-control'
import { cn } from '@/lib/utils'

// The worker's control plane, on the page where the work is.
//
// It controls a switch, not a process. The worker runs as a daemon precisely so
// that a run survives this tab being closed, so nothing here can start or stop
// it — pressing Start writes "running" and the daemon picks that up on its next
// pass. When no daemon is installed there is nothing to pick it up, and saying
// so plainly is more useful than a button that appears to work.

function relative(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} san əvvəl`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} dəq əvvəl`
  const h = Math.round(m / 60)
  return h < 24 ? `${h} saat əvvəl` : `${Math.round(h / 24)} gün əvvəl`
}

function StatusDot({ status }: { status: WorkerStatus }) {
  const online = status.anyOnline
  const paused = status.desiredState === 'paused'
  const tone = !online
    ? 'text-muted-foreground'
    : paused
      ? 'text-amber-600'
      : 'text-emerald-600'
  const label = !online ? 'oflayn' : paused ? 'dayandırılıb' : 'işləyir'
  return (
    <span className={cn('flex items-center gap-1.5 text-sm font-medium', tone)}>
      <CircleDot className={cn('size-3.5', online && !paused && 'animate-pulse')} />
      {label}
    </span>
  )
}

export function WorkerControlPanel(counts: {
  queued: number
  inBatch: number
  awaitingVerify: number
}) {
  const status = useWorkerStatus()
  const setState = useSetWorkerState()

  if (status.isPending) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <Spinner className="size-4" /> worker vəziyyəti oxunur…
      </div>
    )
  }
  if (!status.data) return null

  return (
    <WorkerControlView
      {...counts}
      status={status.data}
      isPending={setState.isPending}
      onToggle={(desired) => setState.mutate(desired)}
    />
  )
}

/**
 * The panel itself, given everything rather than fetching it.
 *
 * Split out because the states worth looking at are the ones that are hard to
 * arrange: a worker whose heartbeat went stale mid-run, one paused by an
 * operator, one that has never reported at all. Waiting for those to happen in
 * order to see them is how a rarely-rendered branch ships broken — this panel's
 * first version crashed on the ONLINE branch, which only appears when a worker
 * is up.
 */
export function WorkerControlView({
  queued,
  inBatch,
  awaitingVerify,
  status,
  isPending,
  onToggle,
}: {
  queued: number
  inBatch: number
  awaitingVerify: number
  status: WorkerStatus
  isPending: boolean
  onToggle: (desired: 'running' | 'paused') => void
}) {
  const { desiredState, workers, anyOnline } = status
  const newest = workers[0]
  const paused = desiredState === 'paused'
  // The daemon is not installed, or is not running. The switch can still be
  // written — and the worker will honour it whenever it does come up — but
  // nothing will act on it now, and a Start that silently does nothing is the
  // failure this panel exists to prevent.
  const noDaemon = !anyOnline

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <StatusDot status={status} />

        {newest ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-muted-foreground max-w-[38ch] truncate text-xs">
                {anyOnline ? newest.activity : `son siqnal ${relative(newest.ageMs)}`}
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm">
              <p className="font-mono text-[11px]">{newest.worker_id}</p>
              <p>{newest.activity}</p>
              <p className="text-muted-foreground">
                son siqnal {relative(newest.ageMs)}
                {newest.started_at
                  ? ` · ${relative(Date.now() - new Date(newest.started_at).getTime())} işə düşüb`
                  : ''}
              </p>
            </TooltipContent>
          </Tooltip>
        ) : null}

        {newest?.spend_today != null ? (
          <span className="text-muted-foreground text-xs tabular-nums">
            ${newest.spend_today.toFixed(2)}
            {newest.budget_usd != null ? ` / $${newest.budget_usd.toFixed(0)}` : ''}
          </span>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          <span className="text-muted-foreground text-xs tabular-nums">
            {queued} növbədə · {inBatch} provayderdə · {awaitingVerify} yoxlamada
          </span>
          <Button
            size="sm"
            variant={paused ? 'default' : 'outline'}
            disabled={isPending}
            onClick={() => onToggle(paused ? 'running' : 'paused')}
          >
            {isPending ? (
              <Spinner className="size-3.5" />
            ) : paused ? (
              <Play data-icon="inline-start" />
            ) : (
              <Pause data-icon="inline-start" />
            )}
            {paused ? 'İşə sal' : 'Dayandır'}
          </Button>
        </div>
      </div>

      {newest?.last_error ? (
        <p className="text-destructive flex items-start gap-1.5 text-xs">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 break-words">
            son xəta{newest.last_error_at ? ` (${relative(Date.now() - new Date(newest.last_error_at).getTime())})` : ''}:{' '}
            {newest.last_error}
          </span>
        </p>
      ) : null}

      {noDaemon ? (
        <div className="text-muted-foreground bg-muted/40 rounded-md border px-3 py-2 text-xs">
          <p className="text-foreground font-medium">Worker prosesi işləmir.</p>
          <p className="mt-1">
            Bu düymə yalnız <em>istəyi</em> yazır — işi görən proses ayrıca
            işləyir və bu tabdan asılı deyil. Heç bir proses yoxdursa, növbə
            yerində qalır.
          </p>
          <p className="mt-1.5">
            Operator maşınında bir dəfə quraşdırın:{' '}
            <code className="bg-background rounded px-1 py-0.5">npm run worker:install</code>
            {' — '}girişdə özü qalxır, çökəndə yenidən başlayır. Vəziyyət:{' '}
            <code className="bg-background rounded px-1 py-0.5">npm run worker:status</code>
            {', silmək: '}
            <code className="bg-background rounded px-1 py-0.5">npm run worker:uninstall</code>.
          </p>
          {queued ? (
            <p className="mt-1.5">
              {queued} sual gözləyir — proses qalxan kimi götürüləcək.
            </p>
          ) : null}
        </div>
      ) : null}

      {workers.length > 1 ? (
        <p className="text-muted-foreground text-[11px]">
          {workers.filter((w) => w.online).length} aktiv worker ·{' '}
          {workers
            .map((w) => `${w.worker_id}${w.online ? '' : ' (oflayn)'}`)
            .join(', ')}
        </p>
      ) : null}
    </div>
  )
}

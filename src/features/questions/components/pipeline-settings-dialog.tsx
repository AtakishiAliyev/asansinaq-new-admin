import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  useSetAutoApprove,
  useWorkerStatus,
} from '@/features/questions/api/worker-control'

function Toggle({
  checked,
  title,
  hint,
  risk,
  disabled,
  onChange,
}: {
  checked: boolean
  title: string
  hint: string
  risk: string
  disabled?: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors',
        checked ? 'border-primary/40 bg-primary/5' : 'hover:bg-muted/50',
        disabled ? 'opacity-60' : null,
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full border p-0.5 transition-colors',
          checked
            ? 'bg-primary border-primary justify-end'
            : 'bg-muted justify-start',
        )}
      >
        <span className="bg-background size-4 rounded-full shadow-sm" />
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-muted-foreground text-xs">{hint}</span>
        <span className="text-xs text-amber-700">{risk}</span>
      </span>
    </button>
  )
}

// Every switch here buys speed or money with a specific risk, so each one
// states the risk in the same breath as the saving. Defaults are off: an
// operator who never opens this dialog gets the careful pipeline.
//
// Read from and written to the WORKER's control plane, beside the pause switch
// — not to a browser store. The worker is what acts on these, and a setting it
// cannot reach is a setting that does not exist: that is precisely what this
// dialog offered from the refactor that moved structuring off the browser
// until now, a control with nothing on the other end.
export function PipelineSettingsDialog({ onClose }: { onClose: () => void }) {
  const status = useWorkerStatus()
  const setAutoApprove = useSetAutoApprove()
  const autoApprove = status.data?.autoApprove ?? false
  const needsAnswer = status.data?.autoApproveNeedsAnswer ?? true
  const busy = status.isPending || setAutoApprove.isPending

  return (
    <Dialog open onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Emal parametrləri</DialogTitle>
          <DialogDescription>
            Böyük kitablar üçün sürət/xərc tənzimləmələri. Hamısı sönülü olanda
            sistem ən diqqətli rejimdə işləyir. Dəyişiklik işçinin növbəti
            keçidindən etibarən qüvvəyə minir.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Toggle
            checked={autoApprove}
            disabled={busy}
            onChange={(next) => setAutoApprove.mutate({ autoApprove: next })}
            title="Təmiz sualları avtomatik təsdiqlə"
            hint="Yoxlama dalğası orijinala uyğun sayan, qoruyucu etirazı olmayan və lint xətası verməyən suallar review-siz təsdiqlənir. 10k sualda ~28 saat əl işini aradan qaldırır."
            risk="Fiqurlu suallar da keçir: kəsilmiş fiqur xəbərdarlığı tək başına saxlamır, çünki `gen` kitabında hər fiqur kəsimdir."
          />

          {autoApprove ? (
            <Toggle
              checked={needsAnswer}
              disabled={busy}
              onChange={(next) =>
                setAutoApprove.mutate({ autoApproveNeedsAnswer: next })
              }
              title="Yalnız cavab açarı olanları"
              hint="Cavabı çap olunmuş açardan gələn suallar təsdiqlənir; cavabsızlar review-də qalır."
              risk="Sönülü olsa, cavabsız suallar da bankda təsdiqli görünəcək."
            />
          ) : null}
        </div>

        <DialogFooter>
          <Button onClick={onClose}>Bağla</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

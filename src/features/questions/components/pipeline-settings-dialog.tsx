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
import { usePipelineStore } from '@/stores/pipeline-store'

function Toggle({
  checked,
  title,
  hint,
  risk,
  onChange,
}: {
  checked: boolean
  title: string
  hint: string
  risk: string
  onChange: (next: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors',
        checked ? 'border-primary/40 bg-primary/5' : 'hover:bg-muted/50',
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full border p-0.5 transition-colors',
          checked ? 'bg-primary border-primary justify-end' : 'bg-muted justify-start',
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
export function PipelineSettingsDialog({ onClose }: { onClose: () => void }) {
  const s = usePipelineStore()

  return (
    <Dialog open onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Emal parametrləri</DialogTitle>
          <DialogDescription>
            Böyük kitablar üçün sürət/xərc tənzimləmələri. Hamısı sönülü
            olanda sistem ən diqqətli rejimdə işləyir.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Toggle
            checked={s.autoApprove}
            onChange={(autoApprove) => s.set({ autoApprove })}
            title="Təmiz sualları avtomatik təsdiqlə"
            hint="Xətasız, təsdiqlənmiş və AI kateqoriyası olan suallar review-siz təsdiqlənir. 10k sualda ~28 saat əl işini aradan qaldırır."
            risk="Doğrulama mərhələsi hazır olana qədər heç bir sual bu şərti keçmir — hamısı review-də qalır."
          />

          {s.autoApprove ? (
            <Toggle
              checked={s.autoApproveNeedsAnswer}
              onChange={(autoApproveNeedsAnswer) =>
                s.set({ autoApproveNeedsAnswer })
              }
              title="Yalnız cavab açarı olanları"
              hint="Cavabı çap olunmuş açardan gələn suallar təsdiqlənir; cavabsızlar review-də qalır."
              risk="Sönülü olsa, cavabsız suallar da bankda təsdiqli görünəcək."
            />
          ) : null}

        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={s.reset}>
            Standarta qaytar
          </Button>
          <Button onClick={onClose}>Bağla</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

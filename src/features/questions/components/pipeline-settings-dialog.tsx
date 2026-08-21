import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
          <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">Paket ölçüsü</span>
              <span className="text-muted-foreground text-xs">
                Bir dəfəyə neçə sual götürülsün. Böyük paket sürətlidir, amma
                tab bağlananda daha çoxu yenidən işlənir.
              </span>
            </div>
            <Select
              value={String(s.batchSize)}
              onValueChange={(v) => s.set({ batchSize: Number(v) })}
            >
              <SelectTrigger className="w-24" aria-label="Paket ölçüsü">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {[4, 8, 12, 16, 24].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">Agent modeli</span>
              <span className="text-muted-foreground text-xs">
                Agent dövrəsini hansı model aparır. Gemini 3.1 Pro layihənin
                mövcud kreditindən işləyir; Claude modelləri ayrıca ödənişlidir
                (Opus sıx səhifəni daha etibarlı oxuyur, təxminən 2.5 qat baha).
              </span>
            </div>
            <Select
              value={s.agentModel}
              onValueChange={(v) =>
                s.set({ agentModel: v as 'claude-sonnet-5' | 'claude-opus-5' })
              }
            >
              <SelectTrigger className="w-36" aria-label="Agent modeli">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="gemini-3.1-pro-preview">Gemini 3.1 Pro</SelectItem>
                  <SelectItem value="gemini-3.5-flash">Gemini 3.5 Flash</SelectItem>
                  <SelectItem value="claude-sonnet-5">Sonnet 5</SelectItem>
                  <SelectItem value="claude-opus-5">Opus 5</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">Şəkil modeli</span>
              <span className="text-muted-foreground text-xs">
                Fiqurları və şəkilli variantları kim yenidən çəkir. gpt-image
                ölçülmüş yoldur — şəkil başına ~$0.08 və 40–90 saniyə. Gemini
                ucuzdur ($0.067) və layihənin mövcud kreditindən işləyir, amma
                skan fiqurlarda nə sürəti, nə dəqiqliyi hələ ölçülməyib.
              </span>
            </div>
            <Select
              value={s.imageModel}
              onValueChange={(v) => s.set({ imageModel: v as 'openai' | 'gemini' })}
            >
              <SelectTrigger className="w-36" aria-label="Şəkil modeli">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="openai">gpt-image</SelectItem>
                  <SelectItem value="gemini">Gemini Flash Image</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <Toggle
            checked={s.autoApprove}
            onChange={(autoApprove) => s.set({ autoApprove })}
            title="Təmiz sualları avtomatik təsdiqlə"
            hint="Xətasız, iki oxunuşu üst-üstə düşən və AI kateqoriyası olan suallar review-siz təsdiqlənir. 10k sualda ~28 saat əl işini aradan qaldırır."
            risk="Hər iki oxunuşun eyni səhvi etdiyi nadir hal insan gözündən yayınır."
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

          <Toggle
            checked={s.mediumImages}
            onChange={(mediumImages) => s.set({ mediumImages })}
            title="Fiqurları orta keyfiyyətdə çək"
            hint="Şəkil xərcini təxminən yarıya endirir — 10k sualda yüzlərlə dollar."
            risk="İncə xətlər və kiçik etiketlər ilk itən yerdir."
          />

          <Toggle
            checked={s.dslFirst}
            onChange={(dslFirst) => s.set({ dslFirst })}
            title="Rəngli fiqurlarda əvvəlcə vektor sınansın"
            hint="Alınsa, $0.08-lıq şəkil generasiyası tamamilə keçilir."
            risk="Vektor dili hər rəng həllini ifadə edə bilmir; alınmasa bir extract xərci artıq gedir."
          />
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

import { CircleSlash, ImageOff, ShieldCheck } from 'lucide-react'
import type { FigureDoc, ImageFig } from '@/core/figures/figspec'
import { cn } from '@/lib/utils'

// What the reproduction lane did to each figure, shown as the three things it
// actually involves: the page it came from, the cut that is the source of
// truth, and the reproduction that is being DISPLAYED in its place.
//
// The display substitution is the reason this panel exists. When the guard
// accepts a reproduction, the question preview draws the reproduction and not
// the cut — so a reviewer looking only at the preview is judging the redrawn
// figure against nothing. The guard compares structure and colour and says
// plainly that it does not read labels; a number that drifted from 3 to 8 is
// invisible to it and invisible in the preview, and this panel is the only
// place it can be caught.
export function FigureLanePanel({
  figures,
  cropUrl,
  resolveImageUrl,
}: {
  figures: FigureDoc | null
  cropUrl: string | undefined
  resolveImageUrl: (src: string) => string
}) {
  const lane = (figures?.items ?? [])
    .map((item, index) => ({ item, index }))
    .filter(
      (entry): entry is { item: ImageFig; index: number } =>
        entry.item.kind === 'image' &&
        // Only figures the lane touched. A book on `cut` has neither field, and
        // showing it an empty third column would imply a failure.
        Boolean(entry.item.genSrc || entry.item.genRejected),
    )
  if (!lane.length) return null

  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground font-mono text-[11px] tracking-[0.14em] uppercase">
        Fiqur lenti — kəsim / təkrar çəkiliş
      </p>
      {lane.map(({ item, index }) => (
        <FigureLaneRow
          key={index}
          item={item}
          cropUrl={cropUrl}
          resolveImageUrl={resolveImageUrl}
        />
      ))}
    </div>
  )
}

function FigureLaneRow({
  item,
  cropUrl,
  resolveImageUrl,
}: {
  item: ImageFig
  cropUrl: string | undefined
  resolveImageUrl: (src: string) => string
}) {
  const accepted = Boolean(item.genSrc)
  return (
    <div
      className={cn(
        'rounded-md border p-2',
        accepted ? 'border-emerald-600/40' : 'border-amber-600/40',
      )}
    >
      <div className="grid gap-2 sm:grid-cols-3">
        <Cell label="orijinal crop" src={cropUrl} />
        <Cell
          label="təmizlənmiş kəsim (mənbə)"
          src={item.src ? resolveImageUrl(item.src) : undefined}
        />
        <div className="flex flex-col gap-1">
          <p className="text-muted-foreground text-[11px]">
            {accepted ? (
              <span className="inline-flex items-center gap-1 text-emerald-600">
                <ShieldCheck className="size-3" /> 1:1 təkrar çəkiliş —
                göstərilir
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-amber-600">
                <CircleSlash className="size-3" /> təkrar çəkiliş rədd edildi
              </span>
            )}
          </p>
          {accepted ? (
            <div className="rounded border bg-white p-1">
              <img
                src={resolveImageUrl(item.genSrc!)}
                alt="Təkrar çəkiliş"
                className="w-full"
              />
            </div>
          ) : (
            <p className="text-muted-foreground rounded border border-dashed p-2 text-xs">
              {item.genRejected ?? 'səbəb qeyd olunmayıb'}
            </p>
          )}
        </div>
      </div>
      {accepted ? (
        // Said out loud, because the guard's own report says `labelsChecked:
        // false` and a reviewer cannot be expected to know that.
        <p className="text-muted-foreground mt-1.5 text-[11px]">
          Qoruyucu quruluşu və rəngi yoxlayıb, <b>yazıları yox</b> — rəqəmləri
          və hərfləri kəsimlə tutuşdurun.
        </p>
      ) : null}
    </div>
  )
}

function Cell({ label, src }: { label: string; src: string | undefined }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-muted-foreground text-[11px]">{label}</p>
      <div className="flex items-center justify-center rounded border bg-white p-1">
        {src ? (
          <img src={src} alt={label} className="w-full" />
        ) : (
          <ImageOff className="text-muted-foreground my-6 size-4" />
        )}
      </div>
    </div>
  )
}

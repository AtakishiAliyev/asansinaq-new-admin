import { useState } from 'react'
import { CircleAlert, Info } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
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
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import type { MatchResult } from '@/core/answer-key/match'

// The gate between reading a key and writing it. A key applied to the wrong
// section is worse than no key at all — every question would carry a
// confident, wrong answer — so nothing is written until the operator sees
// which questions each block lands on.
export function AnswerKeyDialog({
  match,
  notes,
  isPending,
  onCancel,
  onConfirm,
}: {
  match: MatchResult
  notes: string[]
  isPending: boolean
  onCancel: () => void
  onConfirm: (overrides: Map<number, number>) => void
}) {
  // block index → section index the operator chose instead of the inferred one
  const [overrides, setOverrides] = useState<Map<number, number>>(new Map())

  const totalPairs = match.blocks.reduce(
    (sum, b) => sum + (overrides.has(match.blocks.indexOf(b)) ? b.block.entries.length : b.pairs.length),
    0,
  )

  return (
    <Dialog open onOpenChange={(next) => (!next && !isPending ? onCancel() : undefined)}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-3 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Cavab açarı — yoxlama</DialogTitle>
          <DialogDescription>
            Hər blokun hansı suallara yazılacağını təsdiqləyin. Cavablar
            arxivlənir, ona görə sonradan çıxarılan suallara da tətbiq oluna
            bilər.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
          {match.blocks.map((block, i) => {
            const chosen = overrides.get(i)
            const section = chosen
              ? match.sections.find((s) => s.index === chosen)
              : block.inferredSection
                ? match.sections.find((s) => s.index === block.inferredSection)
                : undefined
            const matchedCount = chosen ? '—' : block.pairs.length
            const isPlaced = Boolean(section) || block.pairs.length > 0
            return (
              <div
                key={block.block.sourcePage}
                className={cn(
                  'rounded-lg border p-3',
                  !isPlaced && 'border-destructive/40 bg-destructive/5',
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs tracking-[0.14em] uppercase">
                    s.{block.block.sourcePage}
                  </span>
                  {block.block.testNo ? (
                    <Badge variant="outline">test {block.block.testNo}</Badge>
                  ) : (
                    <Badge variant="outline">test nömrəsi yoxdur</Badge>
                  )}
                  <span className="text-muted-foreground text-sm">
                    {block.block.entries.length} cavab
                  </span>
                  <span
                    className={cn(
                      'text-sm',
                      isPlaced ? 'text-emerald-700' : 'text-destructive',
                    )}
                  >
                    {isPlaced
                      ? `${matchedCount} sualla uyğunlaşdı`
                      : 'uyğun sual tapılmadı'}
                  </span>
                  {block.unmatched.length ? (
                    <span className="text-muted-foreground text-xs">
                      ({block.unmatched.length} sual hələ bazada yoxdur)
                    </span>
                  ) : null}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground text-xs">Bölmə:</span>
                  <Select
                    value={chosen ? String(chosen) : (block.inferredSection ? String(block.inferredSection) : '')}
                    onValueChange={(v) =>
                      setOverrides((current) => {
                        const next = new Map(current)
                        next.set(i, Number(v))
                        return next
                      })
                    }
                  >
                    <SelectTrigger className="w-72" aria-label="Bölmə seç">
                      <SelectValue placeholder="bölmə seçin" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {match.sections.map((s) => (
                          <SelectItem key={s.index} value={String(s.index)}>
                            {s.index}. bölmə · s.{s.from}–{s.to} · {s.count} sual
                            {s.testNo ? ` · test ${s.testNo}` : ''}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  {section ? (
                    <span className="text-muted-foreground text-xs">
                      s.{section.from}–{section.to}, {section.count} sual
                    </span>
                  ) : null}
                </div>

                <p className="text-muted-foreground mt-2 font-mono text-xs">
                  {block.block.entries
                    .slice(0, 14)
                    .map((e) => `${e.qNo}${e.answer}`)
                    .join('  ')}
                  {block.block.entries.length > 14 ? ' …' : ''}
                </p>
              </div>
            )
          })}

          {notes.map((note, i) => (
            <p
              key={`${i}-${note}`}
              className="text-muted-foreground flex items-start gap-1.5 text-xs"
            >
              <Info className="mt-px size-3.5 shrink-0" />
              {note}
            </p>
          ))}

          {match.blocks.some((b) => !b.pairs.length) ? (
            <p className="text-destructive flex items-start gap-1.5 text-xs">
              <CircleAlert className="mt-px size-3.5 shrink-0" />
              Uyğunlaşmayan blok var: həmin bölmənin suallarını əvvəlcə
              çıxarılmaya göndərin, sonra açarı yenidən tətbiq edin.
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isPending}>
            İmtina
          </Button>
          <Button onClick={() => onConfirm(overrides)} disabled={isPending}>
            {isPending ? <Spinner data-icon="inline-start" /> : null}
            {totalPairs > 0 ? `${totalPairs} suala yaz` : 'Yalnız arxivlə'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, TriangleAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { QuestionPreview } from '@/components/question/question-preview'
import { worstLevel } from '@/core/questions/lint'
import type { StructuringItem } from '@/features/questions/hooks/use-restructure'

// A3's minimal quality-check surface: original crop vs recreation, one
// question at a time. The full review workbench (approve/edit/queues)
// replaces this as the daily driver in the next step.
export function RecreationCheckDialog({
  items,
  open,
  onClose,
}: {
  items: StructuringItem[]
  open: boolean
  onClose: () => void
}) {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (open) setIndex(0)
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1))
      if (e.key === 'ArrowRight')
        setIndex((i) => Math.min(items.length - 1, i + 1))
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, items.length])

  const item = items[Math.min(index, items.length - 1)]
  if (!open || !item) return null
  const level = worstLevel(item.flags)

  return (
    <Dialog open onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent className="flex max-h-[94vh] flex-col gap-3 sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono text-sm tracking-[0.14em] uppercase">
              Səhifə {item.row.page_number} · Sual {item.row.q_no}
            </span>
            {item.status === 'failed' ? (
              <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">
                alınmadı
              </Badge>
            ) : item.verified && level === 'clean' ? (
              <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                təsdiqlənib — iki oxunuş üst-üstə düşür
              </Badge>
            ) : (
              <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
                diqqət tələb edir
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Orijinal crop və AI-nin yenidən yaratdığı sual yan-yana — ox
            düymələri ilə keçin.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 gap-3 overflow-auto md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <p className="text-muted-foreground font-mono text-[11px] tracking-[0.14em] uppercase">
              Orijinal
            </p>
            <div className="rounded-md border bg-white p-2">
              <img src={item.crop.dataUrl} alt="Orijinal crop" className="w-full" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="text-muted-foreground font-mono text-[11px] tracking-[0.14em] uppercase">
              Yenidən yaradılmış
            </p>
            <div className="rounded-md border bg-white p-3">
              {item.question &&
              (item.question.stem ||
                item.question.options.length ||
                item.question.figures?.items.length) ? (
                <QuestionPreview
                  question={{
                    stem: item.question.stem,
                    options: item.question.options,
                    figures: item.question.figures,
                  }}
                />
              ) : (
                <p className="text-destructive text-sm">
                  {item.error ?? 'nəticə yoxdur'}
                </p>
              )}
            </div>
          </div>
        </div>

        {item.flags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {item.flags.map((f, i) => (
              <Badge
                key={`${f.code}-${i}`}
                variant="outline"
                className={
                  f.level === 'error'
                    ? 'border-destructive/30 bg-destructive/10 text-destructive'
                    : 'border-amber-200 bg-amber-50 text-amber-800'
                }
                title={f.message}
              >
                <TriangleAlert />
                {f.code}
              </Badge>
            ))}
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label="Əvvəlki"
            aria-disabled={index <= 0}
            className={index <= 0 ? 'pointer-events-none opacity-50' : undefined}
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
          >
            <ChevronLeft />
          </Button>
          <span className="text-muted-foreground text-sm tabular-nums">
            {Math.min(index, items.length - 1) + 1} / {items.length}
          </span>
          <Button
            variant="outline"
            size="icon"
            aria-label="Növbəti"
            aria-disabled={index >= items.length - 1}
            className={
              index >= items.length - 1 ? 'pointer-events-none opacity-50' : undefined
            }
            onClick={() => setIndex((i) => Math.min(items.length - 1, i + 1))}
          >
            <ChevronRight />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

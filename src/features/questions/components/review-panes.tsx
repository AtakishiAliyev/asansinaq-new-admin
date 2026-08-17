import { QuestionPreview } from '@/components/question/question-preview'
import type { QuestionListItem } from '@/features/questions/api/questions'
import { parseFigures, parseOptions } from '@/features/questions/lib/row'

/** Side by side, same renderer as production — the whole point of the review. */
export function ReviewPanes({
  item,
  cropUrl,
  isSigning,
  resolveImageUrl,
}: {
  item: QuestionListItem
  cropUrl: string | undefined
  isSigning: boolean
  resolveImageUrl: (src: string) => string
}) {
  return (
    <div className="grid min-h-0 flex-1 gap-3 overflow-auto md:grid-cols-2">
      <div className="flex flex-col gap-1.5">
        <p className="text-muted-foreground font-mono text-[11px] tracking-[0.14em] uppercase">
          Orijinal
        </p>
        <div className="rounded-md border bg-white p-2">
          {cropUrl ? (
            <img src={cropUrl} alt="Orijinal crop" className="w-full" />
          ) : (
            <div className="text-muted-foreground flex h-40 items-center justify-center text-sm">
              {isSigning ? 'yüklənir…' : 'crop açıla bilmədi'}
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-muted-foreground font-mono text-[11px] tracking-[0.14em] uppercase">
          Yenidən yaradılmış
        </p>
        <div className="rounded-md border bg-white p-3">
          {item.stem ? (
            <QuestionPreview
              question={{
                stem: item.stem,
                options: parseOptions(item.options),
                figures: parseFigures(item.figures),
              }}
              resolveImageUrl={resolveImageUrl}
            />
          ) : (
            <p className="text-destructive text-sm">
              {item.extraction_error ?? 'nəticə yoxdur'}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

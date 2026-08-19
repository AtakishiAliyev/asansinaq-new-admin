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
  // A diagram question has no stem — its wording is printed above the group
  // and never enters the crop. Gating the preview on `stem` hid a row that was
  // fully extracted: five options, a generated figure, both reads agreeing.
  const options = parseOptions(item.options)
  const figures = parseFigures(item.figures)
  const recreated =
    item.stem || options.length || figures?.items.length
      ? { stem: item.stem ?? '', options, figures }
      : null

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
          {recreated ? (
            <QuestionPreview
              answer={item.answer}
              question={recreated}
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

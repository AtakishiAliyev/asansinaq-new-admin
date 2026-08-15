import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import type { PageResult } from '@/features/import/hooks/use-segmentation'

const FIGURE_LABEL = {
  colored: 'rəngli fiqur',
  rule: 'sxem/cədvəl',
  none: null,
} as const

export function CropGrid({ results }: { results: PageResult[] }) {
  return (
    <div className="flex flex-col gap-8">
      {results.map((page) => (
        <section key={page.pageNumber} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium">
              Səhifə {page.pageNumber}
              {page.testNo !== undefined ? ` — Test ${page.testNo}` : ''}
            </h2>
            <Badge variant="secondary">{page.crops.length} sual</Badge>
            {page.isScan ? (
              <Badge variant="outline">skan — AI yolu gözləyir</Badge>
            ) : null}
          </div>

          {page.notes.map((note, i) => (
            // Notes can repeat verbatim across columns; the array is built once
            // per page and never reordered, so the index is a stable key.
            <Alert key={`${i}-${note}`}>
              <AlertDescription>{note}</AlertDescription>
            </Alert>
          ))}

          {page.crops.length > 0 ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
              {page.crops.map((crop) => (
                <figure
                  key={`${crop.col}-${crop.number}`}
                  className="bg-card flex flex-col gap-1.5 rounded-lg border p-2"
                >
                  <figcaption className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">№{crop.number}</span>
                    {FIGURE_LABEL[crop.figureKind] ? (
                      <Badge variant="outline">
                        {FIGURE_LABEL[crop.figureKind]}
                      </Badge>
                    ) : null}
                  </figcaption>
                  <img
                    src={crop.dataUrl}
                    alt={`Sual ${crop.number}, səhifə ${crop.pageNumber}`}
                    className="w-full rounded border bg-white"
                  />
                </figure>
              ))}
            </div>
          ) : null}
        </section>
      ))}
    </div>
  )
}

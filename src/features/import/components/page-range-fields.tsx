import { KeyRound, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import type { useImportAnswerKeys } from '@/features/import/hooks/use-import-answer-keys'
import type { PageRanges } from '@/features/import/hooks/use-page-ranges'

// The two page-range inputs and the book-wide key action. The key-pages field
// is hidden until something needs it — a scan, or a section the book-wide
// pass could not settle — because two ways to read a key on screen at once
// offered the harder route with equal weight to the one that needs nothing.
export function PageRangeFields({
  pageCount,
  ranges,
  keys,
  running,
  hasBook,
  onSegment,
}: {
  pageCount: number
  ranges: PageRanges
  keys: ReturnType<typeof useImportAnswerKeys>
  running: boolean
  hasBook: boolean
  onSegment: () => void
}) {
  return (
    <>
      <div
        className={
          keys.manualKeyOpen ? 'grid gap-3 sm:grid-cols-2' : 'grid gap-3'
        }
      >
        <Field data-invalid={ranges.rangeError ? true : undefined}>
          <FieldLabel htmlFor="range">Sual səhifələri</FieldLabel>
          <div className="flex gap-2">
            <Input
              id="range"
              value={ranges.rangeInput}
              placeholder="məs. 4-8, 11"
              aria-invalid={ranges.rangeError ? true : undefined}
              onFocus={() => ranges.setActiveRange('questions')}
              onChange={(e) => {
                ranges.setRangeInput(e.target.value)
                ranges.setRangeError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSegment()
              }}
            />
            <Button onClick={onSegment} disabled={running}>
              {running ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <Play data-icon="inline-start" />
              )}
              Çıxar
            </Button>
          </div>
          {ranges.rangeError ? (
            <p className="text-destructive text-sm">{ranges.rangeError}</p>
          ) : (
            <FieldDescription>
              {ranges.activeRange === 'questions'
                ? 'Səhifələrə kliklə seçim bu sahəyə düşür.'
                : 'Kliklə seçim üçün bu sahəyə toxunun.'}
            </FieldDescription>
          )}
        </Field>

        {keys.manualKeyOpen ? (
          <Field data-invalid={ranges.keyRangeError ? true : undefined}>
            <FieldLabel htmlFor="key-range">Cavab açarı səhifələri</FieldLabel>
            <div className="flex gap-2">
              <Input
                id="key-range"
                value={ranges.keyRangeInput}
                placeholder="məs. 11, 19"
                aria-invalid={ranges.keyRangeError ? true : undefined}
                onFocus={() => ranges.setActiveRange('keys')}
                onChange={(e) => {
                  ranges.setKeyRangeInput(e.target.value)
                  ranges.setKeyRangeError(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') keys.startAnswerKeys()
                }}
              />
              <Button
                variant="outline"
                onClick={keys.startAnswerKeys}
                disabled={
                  running ||
                  keys.answerKeys.status === 'running' ||
                  !hasBook ||
                  !ranges.keyRangeInput.trim() ||
                  // The key is stored against the question pages, so there is
                  // nothing to pair it with until they exist.
                  !ranges.rangeInput.trim()
                }
                title={
                  hasBook
                    ? 'Seçilən səhifələri cavab açarı kimi oxu'
                    : 'Əvvəlcə arxivdən kitab açın'
                }
              >
                {keys.answerKeys.status === 'running' ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <KeyRound data-icon="inline-start" />
                )}
                Oxu
              </Button>
            </div>
            {ranges.keyRangeError ? (
              <p className="text-destructive text-sm">{ranges.keyRangeError}</p>
            ) : (
              <FieldDescription>
                {hasBook
                  ? 'Bu səhifələr yuxarıdakı sual səhifələri ilə cütlənir.'
                  : 'Kitab açıldıqdan sonra aktivləşir.'}
              </FieldDescription>
            )}
          </Field>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-md border p-3">
        <Button
          onClick={keys.startBookKey}
          disabled={running || keys.bookKeys.status === 'running' || !hasBook}
          title={
            hasBook
              ? 'Bütün kitabı oxu və hər bölmənin cavab açarını tap'
              : 'Əvvəlcə arxivdən kitab açın'
          }
        >
          {keys.bookKeys.status === 'running' ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <KeyRound data-icon="inline-start" />
          )}
          Kitabın açarını oxu
        </Button>
        <p className="text-muted-foreground flex-1 text-xs">
          {keys.bookKeys.status === 'running'
            ? `Oxunur — ${keys.bookKeys.current} / ${keys.bookKeys.total} səhifə`
            : 'Bütün kitabı bir dəfəyə oxuyur, hansı açarın hansı bölməyə aid olduğunu özü tapır və planı təsdiqə verir. Pulsuzdur; sonra kəsdiyiniz hər sualın cavabı özü gəlir.'}
        </p>
        {keys.manualKeyOpen ? null : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => keys.setManualKeyOpen(true)}
            className="text-muted-foreground"
          >
            Əl ilə seç
          </Button>
        )}
      </div>

      <p className="text-muted-foreground text-xs">
        Yazı ilə (4-8, 11) və ya yuxarıdakı səhifələrə kliklə seçin — cəmi{' '}
        {pageCount} səhifə.
      </p>
    </>
  )
}

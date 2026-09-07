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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { formatPages } from '@/core/segment/page-range'
import type { BatchMatch } from '@/core/answer-key/batch'

// The gate between reading a key and writing it.
//
// It used to ask the operator to place each block against a section the
// pipeline had INFERRED, and the inference is gone: the pages behind this
// dialog say which questions the key answers. One choice survives, and it is
// a different kind of choice. A key page routinely prints a grid of tests and
// every one of them numbers from 1, so the page answers "question 1" a dozen
// ways; the pairing cannot say which block on the page is meant, and neither
// can the geometry. So the operator picks from what the page actually
// printed — stating a fact, not correcting a guess — and only when there is
// more than one.
//
// The rest is arithmetic worth a person's eye. A key answering numbers no
// question carries, a page range holding two question 1s, or a key answering
// one number two ways all mean the ranges do not line up, and writing on that
// would put a confident wrong answer on a real question — which the pipeline
// treats as worse than no answer at all.
export function AnswerKeyDialog({
  match,
  questionPages,
  keyPages,
  labels,
  section,
  onSection,
  notes,
  isPending,
  onCancel,
  onConfirm,
}: {
  match: BatchMatch
  questionPages: number[]
  keyPages: number[]
  labels: string[]
  section: string | undefined
  onSection: (section: string) => void
  notes: string[]
  isPending: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const needsSection = match.sections.length > 1 && section === undefined
  const blocked = match.ambiguous.length > 0 || needsSection
  // Everything the chosen block answers, whether or not the question exists
  // yet. Archiving is the whole reason a key may be read before its crops
  // are sent, so a run that writes nothing today is still worth keeping.
  const archivable = match.pairs.length + match.unmatched.length
  const nothingCropped = match.questionCount === 0 && archivable > 0

  return (
    <Dialog open onOpenChange={(next) => (!next && !isPending ? onCancel() : undefined)}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-3 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Cavab açarı — yoxlama</DialogTitle>
          <DialogDescription>
            <span className="font-mono">s.{formatPages(keyPages)}</span>{' '}
            səhifələrindəki cavablar{' '}
            <span className="font-mono">s.{formatPages(questionPages)}</span>{' '}
            səhifələrindəki suallara yazılacaq. Cavablar arxivlənir, ona görə
            sonradan kəsilən suallara da tətbiq olunur.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-3 overflow-y-auto">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="default">
              {match.pairs.length
                ? `${match.pairs.length} cavab yazılacaq`
                : `${archivable} cavab arxivlənəcək`}
            </Badge>
            <Badge variant="outline">{match.questionCount} sual bu səhifələrdə</Badge>
            {labels.length ? (
              <Badge variant="outline" className="font-normal">
                açarda: {labels.slice(0, 4).join(', ')}
                {labels.length > 4 ? '…' : ''}
              </Badge>
            ) : null}
          </div>

          {match.sections.length > 1 ? (
            <div className="rounded-md border p-3">
              <p className="text-sm font-medium">
                Açar səhifəsində {match.sections.length} bölmə var — hansını
                yazaq?
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                Hər bölmə sualları 1-dən nömrələyir, ona görə səhifə "1-ci
                sual"a bir neçə cavab verir. Seçilən bölmə yuxarıdakı sual
                səhifələrinə yazılacaq.
              </p>
              <Select value={section ?? ''} onValueChange={onSection}>
                <SelectTrigger className="mt-2 w-72">
                  <SelectValue placeholder="Bölmə seçin" />
                </SelectTrigger>
                <SelectContent>
                  {match.sections.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.label} — {s.count} cavab
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {match.conflicting.length ? (
            <Numbers
              tone="error"
              title="Açar bu nömrələrə bir neçə cavab verir"
              body="Seçilən bölmədə eyni sual nömrəsi fərqli cavablarla çap olunub. Hansının doğru olduğu bilinmir, ona görə bu nömrələr yazılmayacaq."
              numbers={match.conflicting}
            />
          ) : null}

          {match.ambiguous.length ? (
            <Numbers
              tone="error"
              title="Sual nömrələri təkrarlanır — heç nə yazılmayacaq"
              body="Seçilən səhifələrdə bu nömrələr birdən çox dəfə çap olunub, yəni aralıq bölmə sərhədini keçir. Açarın hansını nəzərdə tutduğu bilinmir. Aralığı bölüb hər bölmə üçün ayrıca oxuyun."
              numbers={match.ambiguous}
            />
          ) : null}

          {nothingCropped ? (
            <div className="rounded-md border p-3">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <Info className="size-4 shrink-0" />
                Bu səhifələrin sualları hələ banka göndərilməyib
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                Kəsimlər siyahıda görünür, amma banka yalnız "Növbəyə at" ilə
                yazılır. İndi arxivləsəniz, həmin sualları göndərəndə cavablar
                özləri tətbiq olunacaq — açarı yenidən oxumağa ehtiyac qalmır.
                Əvvəlcə sualları göndərmək istəsəniz, imtina edin və açarı
                sonra oxuyun.
              </p>
            </div>
          ) : null}

          {match.unmatched.length && !nothingCropped ? (
            <Numbers
              tone="info"
              title="Açarda var, bankda hələ yoxdur"
              body="Bu nömrələr üçün sual hələ kəsilməyib. Cavablar arxivlənir və həmin suallar kəsiləndə özləri tətbiq olunacaq."
              numbers={match.unmatched}
            />
          ) : null}

          {match.unanswered.length ? (
            <Numbers
              tone="info"
              title="Sual var, açarda cavabı yoxdur"
              body="Açar bu nömrələr haqqında heç nə demir. Səhv aralıq seçilibsə, indi düzəltmək lazımdır."
              numbers={match.unanswered}
            />
          ) : null}

          {notes.length ? (
            <ul className="text-muted-foreground space-y-1 text-xs">
              {notes.map((note, i) => (
                <li key={i}>· {note}</li>
              ))}
            </ul>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isPending}>
            İmtina
          </Button>
          <Button onClick={onConfirm} disabled={isPending || blocked || !archivable}>
            {isPending ? <Spinner data-icon="inline-start" /> : null}
            {match.pairs.length
              ? `${match.pairs.length} cavabı yaz`
              : `${archivable} cavabı arxivlə`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** A finding, with the numbers it is about. Long lists are truncated: the
 *  point is the shape of the problem, not a transcript. */
function Numbers({
  tone,
  title,
  body,
  numbers,
}: {
  tone: 'error' | 'info'
  title: string
  body: string
  numbers: number[]
}) {
  const Icon = tone === 'error' ? CircleAlert : Info
  return (
    <div
      className={
        tone === 'error'
          ? 'border-destructive/40 bg-destructive/5 rounded-md border p-3'
          : 'rounded-md border p-3'
      }
    >
      <p
        className={
          tone === 'error'
            ? 'text-destructive flex items-center gap-1.5 text-sm font-medium'
            : 'flex items-center gap-1.5 text-sm font-medium'
        }
      >
        <Icon className="size-4 shrink-0" />
        {title}
      </p>
      <p className="text-muted-foreground mt-1 text-xs">{body}</p>
      <p className="mt-1.5 font-mono text-xs">
        {numbers.slice(0, 30).join(', ')}
        {numbers.length > 30 ? ` … (${numbers.length})` : ''}
      </p>
    </div>
  )
}

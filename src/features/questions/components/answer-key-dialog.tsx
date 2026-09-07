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
import { Spinner } from '@/components/ui/spinner'
import { formatPages } from '@/core/segment/page-range'
import type { BatchMatch } from '@/core/answer-key/batch'

// The gate between reading a key and writing it.
//
// It used to ask the operator to pick a SECTION for each block, because the
// pipeline had inferred one and could be wrong. There is nothing left to pick:
// the operator already said which pages this key answers, on the screen behind
// this dialog, so what is shown here is a consequence rather than a guess.
//
// What is still worth a person's eye is the arithmetic. A key that answers
// numbers no question carries, or a page range that holds two question 1s,
// means the ranges do not line up — and writing on that would put a confident
// wrong answer on a real question, which the pipeline treats as worse than no
// answer at all.
export function AnswerKeyDialog({
  match,
  questionPages,
  keyPages,
  labels,
  notes,
  isPending,
  onCancel,
  onConfirm,
}: {
  match: BatchMatch
  questionPages: number[]
  keyPages: number[]
  labels: string[]
  notes: string[]
  isPending: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const blocked = match.ambiguous.length > 0

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
            <Badge variant="default">{match.pairs.length} cavab yazılacaq</Badge>
            <Badge variant="outline">{match.questionCount} sual bu səhifələrdə</Badge>
            {labels.length ? (
              <Badge variant="outline" className="font-normal">
                açarda: {labels.slice(0, 4).join(', ')}
                {labels.length > 4 ? '…' : ''}
              </Badge>
            ) : null}
          </div>

          {blocked ? (
            <Numbers
              tone="error"
              title="Sual nömrələri təkrarlanır — heç nə yazılmayacaq"
              body="Seçilən səhifələrdə bu nömrələr birdən çox dəfə çap olunub, yəni aralıq bölmə sərhədini keçir. Açarın hansını nəzərdə tutduğu bilinmir. Aralığı bölüb hər bölmə üçün ayrıca oxuyun."
              numbers={match.ambiguous}
            />
          ) : null}

          {match.unmatched.length ? (
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
          <Button onClick={onConfirm} disabled={isPending || blocked || !match.pairs.length}>
            {isPending ? <Spinner data-icon="inline-start" /> : null}
            {match.pairs.length} cavabı yaz
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

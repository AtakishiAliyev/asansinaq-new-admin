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
import type { BookKeyPlan } from '@/core/answer-key/book'
import type { BookKeyGroup } from '@/features/questions/hooks/use-book-key-run'

/** How many section rows to draw before summarising the rest. A book can hold
 *  130 of them and nobody reads past the first screen. */
const SHOWN = 40

const LAYOUT: Record<BookKeyPlan['layout'], string> = {
  interleaved: 'Açar hər bölmənin ardınca çap olunub',
  trailing: 'Açar kitabın sonundadır',
  none: 'Açar tapılmadı',
}

// The whole book's key, before anything is written.
//
// What the operator is confirming here is not a match but a READING: the pass
// found the key pages, split the book into sections and worked out which block
// answers which. Nothing was guessed — a section the shape could not settle is
// listed as unresolved rather than filled in — so the question is only whether
// the reading looks like the book.
export function BookKeyDialog({
  plan,
  groups,
  notes,
  isPending,
  onCancel,
  onConfirm,
}: {
  plan: BookKeyPlan
  groups: BookKeyGroup[]
  notes: string[]
  isPending: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const willWrite = groups.reduce((n, g) => n + g.pairs.length, 0)
  const willArchive = groups.reduce((n, g) => n + g.entries.length, 0)
  const covered = groups.reduce((n, g) => n + g.questionCount, 0)
  const missing = plan.unpaired.reduce((n, s) => n + s.numbers.length, 0)

  return (
    <Dialog open onOpenChange={(next) => (!next && !isPending ? onCancel() : undefined)}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-3 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Cavab açarı — bütün kitab</DialogTitle>
          <DialogDescription>
            {LAYOUT[plan.layout]}. Cavablar arxivlənir, ona görə bu səhifələri
            sonra kəssəniz də hər kəsimin cavabı özü gələcək.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-3 overflow-y-auto">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="default">
              {willWrite
                ? `${willWrite} cavab indi yazılacaq`
                : `${willArchive} cavab arxivlənəcək`}
            </Badge>
            <Badge variant="outline">{covered} sual əhatə olunur</Badge>
            <Badge variant="outline">{groups.length} bölmə</Badge>
            <Badge variant="outline">
              açar s.{formatPages(plan.keyPages)}
            </Badge>
          </div>

          {groups.slice(0, SHOWN).map((group) => (
            <div key={group.questionPages.join(',')} className="rounded-md border p-3">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
                <span className="font-mono">s.{formatPages(group.questionPages)}</span>
                <span className="text-muted-foreground">→</span>
                <span>{group.label}</span>
                <Badge variant="outline" className="font-normal">
                  {group.pairs.length
                    ? `${group.pairs.length} yazılır`
                    : `${group.entries.length} arxivlənir`}
                </Badge>
              </p>
              <p className="text-muted-foreground mt-1 text-xs">{group.reason}</p>
            </div>
          ))}

          {groups.length > SHOWN ? (
            <p className="text-muted-foreground text-xs">
              · və daha {groups.length - SHOWN} bölmə — hamısı eyni qayda ilə
            </p>
          ) : null}

          {plan.unpaired.length ? (
            <div className="border-destructive/40 bg-destructive/5 rounded-md border p-3">
              <p className="text-destructive flex items-center gap-1.5 text-sm font-medium">
                <CircleAlert className="size-4 shrink-0" />
                {plan.unpaired.length} bölmə üçün açar təsdiqlənmədi
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                Bu {missing} suala heç nə yazılmır. Kitab ya həmin bölmələrin
                açarını çap etmir, ya da hansı bloka aid olduğu sübut olunmur —
                təxmin etmək hər suala əminliklə yanlış cavab yazardı.
              </p>
              <p className="mt-1.5 font-mono text-xs">
                {plan.unpaired
                  .slice(0, 8)
                  .map((s) => `s.${formatPages(s.pages)}`)
                  .join(', ')}
                {plan.unpaired.length > 8 ? ` … (${plan.unpaired.length})` : ''}
              </p>
            </div>
          ) : null}

          {!willWrite && willArchive ? (
            <div className="rounded-md border p-3">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <Info className="size-4 shrink-0" />
                Bu kitabın sualları hələ banka göndərilməyib
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                Açar indi arxivlənir. Səhifələri kəsib "Növbəyə at" edəndə
                cavablar özləri tətbiq olunacaq — açarı bir daha oxumaq lazım
                deyil.
              </p>
            </div>
          ) : null}

          {notes.length ? (
            <ul className="text-muted-foreground space-y-1 text-xs">
              {notes.slice(0, 10).map((note, i) => (
                <li key={i}>· {note}</li>
              ))}
            </ul>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isPending}>
            İmtina
          </Button>
          <Button onClick={onConfirm} disabled={isPending || !willArchive}>
            {isPending ? <Spinner data-icon="inline-start" /> : null}
            {willWrite ? `${willWrite} cavabı yaz` : `${willArchive} cavabı arxivlə`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

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
import type { KeyPlan, KeyPlanGroup } from '@/core/answer-key/batch'

// The gate between reading a key and writing it.
//
// It has stopped being a question, in two steps. The first version asked the
// operator to place each block against a section the pipeline had INFERRED.
// The second asked which single block of the key page answered the whole
// selection — and that question has no correct answer: an operator picks ten
// pages and the book puts two or three tests in that span, so whichever block
// is chosen, the other tests' questions get nothing.
//
// The book settles it. Every question page prints the test it belongs to, so
// pages that agree form a group and each group takes the block carrying its
// number; a selection spanning three tests simply produces three groups. What
// is shown here is that plan. A choice appears only for pages that printed no
// test at all, and then it is a real choice with its cost spelled out rather
// than a guess dressed as one.
export function AnswerKeyDialog({
  plan,
  questionPages,
  keyPages,
  fallbackSection,
  onSection,
  notes,
  isPending,
  onCancel,
  onConfirm,
}: {
  plan: KeyPlan
  questionPages: number[]
  keyPages: number[]
  fallbackSection: string | undefined
  onSection: (section: string) => void
  notes: string[]
  isPending: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const willWrite = plan.groups.reduce((n, g) => n + g.match.pairs.length, 0)
  const willArchive = plan.groups.reduce((n, g) => n + g.entries.length, 0)
  const cropped = plan.groups.reduce((n, g) => n + g.match.questionCount, 0)
  const ambiguous = [...new Set(plan.groups.flatMap((g) => g.match.ambiguous))]
  const blocked = ambiguous.length > 0 || !plan.groups.length

  return (
    <Dialog open onOpenChange={(next) => (!next && !isPending ? onCancel() : undefined)}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-3 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Cavab açarı — yoxlama</DialogTitle>
          <DialogDescription>
            <span className="font-mono">s.{formatPages(keyPages)}</span>{' '}
            səhifələrindəki cavablar{' '}
            <span className="font-mono">s.{formatPages(questionPages)}</span>{' '}
            səhifələrinə yazılacaq. Cavablar arxivlənir, ona görə sonradan
            kəsilən suallara da tətbiq olunur.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-3 overflow-y-auto">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="default">
              {willWrite
                ? `${willWrite} cavab yazılacaq`
                : `${willArchive} cavab arxivlənəcək`}
            </Badge>
            <Badge variant="outline">{cropped} sual bu səhifələrdə</Badge>
            <Badge variant="outline">{plan.groups.length} bölmə tapıldı</Badge>
          </div>

          {plan.groups.map((group) => (
            <GroupRow key={group.pages.join(',')} group={group} />
          ))}

          {plan.unresolved.length ? (
            <div className="border-destructive/40 bg-destructive/5 rounded-md border p-3">
              <p className="text-destructive flex items-center gap-1.5 text-sm font-medium">
                <CircleAlert className="size-4 shrink-0" />
                s.{formatPages(plan.unresolved)} üçün bölmə tapılmadı
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                Bu səhifələr hansı testə aid olduğunu yazmır. Yalnız BİRİNCİ
                qrupun bölməsini seçin — qalan qruplar açardakı sıra ilə özləri
                düzülür və planı təsdiqdən əvvəl burada görəcəksiniz.
                Seçməsəniz, bu səhifələrə heç nə yazılmır, qalan bölmələr yenə
                yazılır. Səhv bölmə hər suala əminliklə yanlış cavab yazar.
              </p>
              <Select value={fallbackSection ?? ''} onValueChange={onSection}>
                <SelectTrigger className="mt-2 w-72">
                  <SelectValue placeholder="Bölmə seçin" />
                </SelectTrigger>
                <SelectContent>
                  {plan.sections.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.label} — {s.count} cavab
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {ambiguous.length ? (
            <div className="border-destructive/40 bg-destructive/5 rounded-md border p-3">
              <p className="text-destructive flex items-center gap-1.5 text-sm font-medium">
                <CircleAlert className="size-4 shrink-0" />
                Sual nömrələri təkrarlanır — heç nə yazılmayacaq
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                Bir bölmənin içində bu nömrələr birdən çox dəfə çap olunub, yəni
                səhifə qrupu düzgün ayrılmayıb. Açarın hansını nəzərdə tutduğu
                bilinmir.
              </p>
              <p className="mt-1.5 font-mono text-xs">
                {ambiguous.slice(0, 30).join(', ')}
                {ambiguous.length > 30 ? ` … (${ambiguous.length})` : ''}
              </p>
            </div>
          ) : null}

          {!willWrite && willArchive ? (
            <div className="rounded-md border p-3">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <Info className="size-4 shrink-0" />
                Bu səhifələrin sualları hələ banka göndərilməyib
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                Kəsimlər siyahıda görünür, amma banka yalnız "Növbəyə at" ilə
                yazılır. İndi arxivləsəniz, həmin sualları göndərəndə cavablar
                özləri tətbiq olunacaq — açarı yenidən oxumağa ehtiyac qalmır.
              </p>
            </div>
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
          <Button onClick={onConfirm} disabled={isPending || blocked || !willArchive}>
            {isPending ? <Spinner data-icon="inline-start" /> : null}
            {willWrite ? `${willWrite} cavabı yaz` : `${willArchive} cavabı arxivlə`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** One printed section: which pages it covers, which block answers them, and
 *  what that leaves. */
function GroupRow({ group }: { group: KeyPlanGroup }) {
  const { match } = group
  return (
    <div className="rounded-md border p-3">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
        <span className="font-mono">s.{formatPages(group.pages)}</span>
        <span className="text-muted-foreground">→</span>
        <span>{group.section.label}</span>
        <Badge variant="outline" className="font-normal">
          {match.pairs.length
            ? `${match.pairs.length} yazılır`
            : `${group.entries.length} arxivlənir`}
        </Badge>
      </p>
      <p className="text-muted-foreground mt-1 text-xs">{group.reason}</p>
      {match.unanswered.length ? (
        <p className="text-muted-foreground mt-1 text-xs">
          Açarda cavabı olmayan sual: {match.unanswered.slice(0, 20).join(', ')}
          {match.unanswered.length > 20 ? '…' : ''}
        </p>
      ) : null}
    </div>
  )
}

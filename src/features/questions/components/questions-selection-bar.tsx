import { useState } from 'react'
import { Bot, CheckCheck, ListPlus, Square, Trash2, X } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import {
  useBulkApprove,
  useDeleteQuestions,
  type QuestionListItem,
} from '@/features/questions/api/questions'
import { useEnqueue } from '@/features/questions/api/queue'
import { useAgentBatch } from '@/features/questions/hooks/use-agent-batch'
import { usePipelineStore } from '@/stores/pipeline-store'

// Floats over the list instead of sitting above it: the operator selects rows
// while scrolled anywhere in a 50-row page, and an action bar pinned to the
// top would be off-screen exactly when it is needed.
export function QuestionsSelectionBar({
  selected,
  onClear,
}: {
  selected: QuestionListItem[]
  onClear: () => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmAgent, setConfirmAgent] = useState(false)
  const batch = useAgentBatch()
  const agentModel = usePipelineStore((s) => s.agentModel)
  const [confirmApprove, setConfirmApprove] = useState(false)
  const bulkApprove = useBulkApprove()
  const remove = useDeleteQuestions()
  const enqueue = useEnqueue()
  if (!selected.length) return null

  // Approval needs a category, and bulk approval only ever confirms the AI's
  // suggestion — rows without one have to go through the review screen.
  const approvable = selected.filter(
    (q) => q.status === 'structured' && q.ai_category_id,
  )
  const reviewed = selected.filter(
    (q) => q.status === 'approved' || q.status === 'rejected',
  )
  const agentRunning = batch.status === 'running'
  const busy = bulkApprove.isPending || remove.isPending || enqueue.isPending || agentRunning
  // Measured on the probe: Opus averaged $0.72 a question. Sonnet is priced at
  // two fifths of Opus, so its figure is derived, not observed — shown as a
  // range so it does not read as a promise.
  const perQuestion = agentModel === 'claude-opus-5' ? 0.72 : 0.29
  const minutes = Math.max(1, Math.round((selected.length * 110) / 60))

  return (
    <>
      <div className="pointer-events-none sticky bottom-4 z-20 flex justify-center">
        <div className="bg-background pointer-events-auto flex flex-wrap items-center gap-2 rounded-full border py-2 pr-2 pl-4 shadow-lg">
          <span className="text-sm font-medium tabular-nums">
            {selected.length} seçildi
          </span>
          <span className="bg-border h-5 w-px" />

          <Button
            size="sm"
            variant="ghost"
            disabled={busy || !approvable.length}
            onClick={() => setConfirmApprove(true)}
            title={
              approvable.length
                ? `${approvable.length} sual AI kateqoriyası ilə təsdiqlənəcək`
                : 'Seçilənlərdə AI kateqoriyası olan strukturlaşmış sual yoxdur'
            }
          >
            <CheckCheck data-icon="inline-start" />
            Təsdiqlə{approvable.length ? ` (${approvable.length})` : ''}
          </Button>

          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            title="Növbəyə əlavə edir — emal növbə panelindən işə salınır"
            onClick={() =>
              enqueue.mutate(
                selected.map((q) => q.id),
                { onSuccess: onClear },
              )
            }
          >
            {enqueue.isPending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <ListPlus data-icon="inline-start" />
            )}
            Növbəyə at
          </Button>

          {agentRunning ? (
            <Button size="sm" variant="ghost" onClick={batch.stop}>
              <Square data-icon="inline-start" />
              Dayandır ({batch.current}/{batch.total})
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              title="Agent hər crop-a baxır, kəsir və ya çəkir, öz nəticəsini yoxlayır"
              onClick={() => setConfirmAgent(true)}
            >
              <Bot data-icon="inline-start" />
              Agentə göndər
            </Button>
          )}

          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            disabled={busy}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 data-icon="inline-start" />
            Sil
          </Button>

          <Button size="icon" variant="ghost" aria-label="Seçimi təmizlə" onClick={onClear}>
            <X />
          </Button>
        </div>
      </div>

      {agentRunning ? (
        <div className="pointer-events-none sticky bottom-20 z-20 flex justify-center">
          <span className="bg-background text-muted-foreground pointer-events-auto rounded-full border px-3 py-1 text-xs tabular-nums shadow">
            {batch.activity} · {batch.agentStep}. {batch.agentActivity} · {batch.done} hazır
            {batch.gaveUp ? ` · ${batch.gaveUp} təslim` : ''}
            {batch.failed ? ` · ${batch.failed} xəta` : ''}
          </span>
        </div>
      ) : null}

      <AlertDialog open={confirmAgent} onOpenChange={setConfirmAgent}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {selected.length} sual agentə göndərilsin?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Agent hər crop-a baxır, lazım olanda böyüdüb yenidən baxır,
              fiquru ya orijinaldan kəsir, ya vektor çəkir, sonra öz nəticəsini
              orijinalla tutuşdurur. Sual başına 1–3 dəqiqə, təxminən $
              {perQuestion.toFixed(2)} — cəmi <b>≈${(selected.length * perQuestion).toFixed(2)}</b> və{' '}
              <b>≈{minutes} dəqiqə</b>. Bu müddətdə səhifə açıq qalmalıdır;
              istənilən sualın arasında dayandıra bilərsiniz.
              <br />
              <br />
              Model: <b>{agentModel === 'claude-opus-5' ? 'Opus 5' : 'Sonnet 5'}</b> —
              emal parametrlərindən dəyişdirilir. Nəticə <b>təsdiqlənmiş sayılmır</b>:
              agentin öz yoxlaması müstəqil ikinci oxunuş deyil, ona görə hər
              sual review-ə düşür.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>İmtina</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                setConfirmAgent(false)
                void batch.run(selected)
              }}
            >
              Göndər
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmApprove} onOpenChange={setConfirmApprove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {approvable.length} sual təsdiqlənsin?
            </AlertDialogTitle>
            <AlertDialogDescription>
              AI-nin təklif etdiyi kateqoriya təsdiqlənəcək. Çətinlik boş
              qalır — AI-nin təxmini insan qiymətləndirməsi kimi yazılmır;
              onu tək-tək review-də verə bilərsiniz.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkApprove.isPending}>İmtina</AlertDialogCancel>
            <AlertDialogAction
              disabled={bulkApprove.isPending}
              onClick={(e) => {
                e.preventDefault()
                bulkApprove.mutate(
                  approvable.map((q) => ({
                    id: q.id,
                    categoryId: q.ai_category_id as number,
                    reviewerDifficulty: null,
                    answer: null,
                    answerChanged: false,
                  })),
                  {
                    onSuccess: () => {
                      setConfirmApprove(false)
                      onClear()
                    },
                  },
                )
              }}
            >
              {bulkApprove.isPending ? <Spinner data-icon="inline-start" /> : null}
              Təsdiqlə
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{selected.length} sual silinsin?</AlertDialogTitle>
            <AlertDialogDescription>
              Sual sətirləri və crop şəkilləri həmişəlik silinir — geri
              qaytarmaq olmur. Eyni səhifələri yenidən emal etsəniz, suallar
              xam statusda qayıdır, amma yenidən çıxarılmalı olacaq.
              {reviewed.length
                ? ` Seçilənlərin ${reviewed.length}-i artıq review-dən keçib.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>İmtina</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={remove.isPending}
              onClick={(e) => {
                e.preventDefault()
                remove.mutate(selected, {
                  onSuccess: () => {
                    setConfirmDelete(false)
                    onClear()
                  },
                })
              }}
            >
              {remove.isPending ? <Spinner data-icon="inline-start" /> : null}
              Sil
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

import { useState } from 'react'
import { CheckCheck } from 'lucide-react'
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
import {
  useBulkApprove,
  type QuestionListItem,
} from '@/features/questions/api/questions'

// Bulk approval confirms the AI category and nothing else: reviewer_difficulty
// stays null, because writing ai_difficulty there would record a machine guess
// as a human judgement.
export function BulkApproveButton({ items }: { items: QuestionListItem[] }) {
  const [open, setOpen] = useState(false)
  const bulkApprove = useBulkApprove()
  if (!items.length) return null

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={bulkApprove.isPending}
        onClick={() => setOpen(true)}
      >
        <CheckCheck data-icon="inline-start" />
        Təmizləri təsdiqlə ({items.length})
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {items.length} təmiz sual təsdiqlənsin?
            </AlertDialogTitle>
            <AlertDialogDescription>
              AI-nin təklif etdiyi kateqoriya təsdiqlənəcək. Çətinlik
              təyin edilməmiş qalır — AI-nin təxmini insan qiymətləndirməsi kimi
              yazılmır; çətinliyi tək-tək review-də verə bilərsiniz.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>İmtina</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                bulkApprove.mutate(
                  items.map((q) => ({
                    id: q.id,
                    categoryId: q.ai_category_id as number,
                    reviewerDifficulty: null,
                    answer: null,
                    answerChanged: false,
                  })),
                )
              }
            >
              Təsdiqlə
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

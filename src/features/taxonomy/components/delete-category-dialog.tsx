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
import { Spinner } from '@/components/ui/spinner'
import type { CategoryNode } from '@/features/taxonomy/schemas'

interface DeleteCategoryDialogProps {
  category: CategoryNode | null
  isPending: boolean
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
}

export function DeleteCategoryDialog({
  category,
  isPending,
  onConfirm,
  onOpenChange,
}: DeleteCategoryDialogProps) {
  const childCount = category?.children.length ?? 0

  return (
    <AlertDialog
      open={category !== null}
      onOpenChange={(next) => {
        if (!next && isPending) return
        onOpenChange(next)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>«{category?.name}» silinsin?</AlertDialogTitle>
          <AlertDialogDescription>
            {childCount > 0
              ? `İçindəki ${childCount} sub-kateqoriya da silinəcək. Bu əməliyyat geri qaytarıla bilməz.`
              : 'Bu əməliyyat geri qaytarıla bilməz.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>İmtina</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={isPending}
            onClick={(event) => {
              event.preventDefault()
              onConfirm()
            }}
          >
            {isPending ? <Spinner data-icon="inline-start" /> : null}
            Sil
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

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
    <AlertDialog open={category !== null} onOpenChange={onOpenChange}>
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
            disabled={isPending}
            onClick={(event) => {
              event.preventDefault()
              onConfirm()
            }}
          >
            Sil
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

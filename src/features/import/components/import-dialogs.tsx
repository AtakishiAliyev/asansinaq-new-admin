import type { useBlocker } from 'react-router'
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
import type { Book } from '@/features/books'

// The import page's four confirmations. Each guards one thing the operator
// would regret: opening a duplicate, killing a live run, leaving unsent crops,
// and spending money.

export function DuplicateBookDialog({
  book,
  onOpen,
  onClose,
}: {
  book: Book | null
  onOpen: () => void
  onClose: () => void
}) {
  return (
    <AlertDialog
      open={book !== null}
      onOpenChange={(open) => (!open ? onClose() : undefined)}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Bu PDF artıq arxivdədir</AlertDialogTitle>
          <AlertDialogDescription>
            Eyni fayl «{book?.title}» adı ilə qeydiyyatdadır — yenidən yükləməyə
            ehtiyac yoxdur.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>İmtina</AlertDialogCancel>
          <AlertDialogAction onClick={onOpen}>Kitabı aç</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Opening another PDF/book while a run is live needs a yes. */
export function ReplaceRunDialog({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => (!next ? onCancel() : undefined)}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Emal davam edir</AlertDialogTitle>
          <AlertDialogDescription>
            Yeni sənəd açılsa, gedən emal dayandırılacaq və çıxarılan suallar
            silinəcək.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>İmtina</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            Dayandır və aç
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Leaving /import with unsaved crops (or a live run) needs a yes. */
export function LeaveImportDialog({
  blocker,
  running,
  onLeave,
}: {
  blocker: ReturnType<typeof useBlocker>
  running: boolean
  onLeave: () => void
}) {
  return (
    <AlertDialog
      open={blocker.state === 'blocked'}
      onOpenChange={(open) => (!open ? blocker.reset?.() : undefined)}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Emal nəticələri itəcək</AlertDialogTitle>
          <AlertDialogDescription>
            {running
              ? 'Emal hələ davam edir. Səhifəni tərk etsəniz, dayandırılacaq və çıxarılan suallar silinəcək.'
              : 'Bazaya yalnız göndərdiyin suallar yazılır — qalan crop-lar səhifəni tərk etdikdə silinəcək (yenidən emal ilə bərpa olunur).'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => blocker.reset?.()}>
            Qal
          </AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onLeave}>
            Tərk et
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Paid step: show the lane mix and the price before any model runs. */
export function SendConfirmDialog({
  open,
  count,
  laneCounts,
  costLow,
  costHigh,
  onCancel,
  onConfirm,
}: {
  open: boolean
  count: number
  laneCounts: { none: number; rule: number; colored: number }
  costLow: number
  costHigh: number
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => (!next ? onCancel() : undefined)}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {count} sual çıxarılmaya göndərilsin?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Seçilən crop-lar bazaya yazılacaq və AI hər sualı təmiz formada
            yenidən yaradacaq (mətn, variantlar, fiqurlar). Təxmini xərc: ≈ $
            {costLow.toFixed(2)}–${costHigh.toFixed(2)}
            {laneCounts.colored > 0 || laneCounts.rule > 0
              ? ` (mətn: ${laneCounts.none}, sxem: ${laneCounts.rule}, rəngli fiqur: ${laneCounts.colored}; şəkilli variantlar xərci artıra bilər)`
              : ''}
            .{' '}
            {laneCounts.rule > 0
              ? 'Sxem fiquru DSL ilə çəkilə bilməsə, şəkil generasiyasına keçir — bu halda xərc yuxarı hədə yaxınlaşır. '
              : ''}
            Nəticələr Suallar səhifəsində görünür.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>İmtina</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Növbəyə at</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

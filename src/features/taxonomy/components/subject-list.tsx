import { useRef, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
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
import { cn } from '@/lib/utils'
import {
  useCreateSubject,
  useDeleteSubject,
  useRenameSubject,
} from '@/features/taxonomy/api/subjects'
import { NameForm } from '@/features/taxonomy/components/name-form'
import type { Subject } from '@/features/taxonomy/schemas'

interface SubjectListProps {
  programId: number
  subjects: Subject[]
  activeSubjectId: number | null
  onSelect: (id: number) => void
}

export function SubjectList({
  programId,
  subjects,
  activeSubjectId,
  onSelect,
}: SubjectListProps) {
  const createSubject = useCreateSubject()
  const renameSubject = useRenameSubject()
  const deleteSubject = useDeleteSubject()
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Subject | null>(null)
  // Closing an inline form unmounts the focused element, dropping keyboard
  // focus to <body>; restore it to the control that opened the form.
  const editButtonRefs = useRef(new Map<number, HTMLButtonElement>())
  const addButtonRef = useRef<HTMLButtonElement>(null)

  function stopEditing(id: number) {
    setEditingId(null)
    requestAnimationFrame(() => editButtonRefs.current.get(id)?.focus())
  }

  function stopAdding() {
    setAdding(false)
    requestAnimationFrame(() => addButtonRef.current?.focus())
  }

  return (
    <div className="flex flex-col gap-1">
      <p className="text-muted-foreground mb-1 px-1 text-xs tracking-wide">
        FƏNLƏR
      </p>

      {subjects.map((subject) =>
        editingId === subject.id ? (
          <div key={subject.id} className="py-1">
            <NameForm
              defaultName={subject.name}
              placeholder="Fənnin adı"
              isPending={renameSubject.isPending}
              onCancel={() => stopEditing(subject.id)}
              onSubmit={(name) =>
                renameSubject.mutate(
                  { programId, id: subject.id, name },
                  { onSuccess: () => stopEditing(subject.id) },
                )
              }
            />
          </div>
        ) : (
          <div
            key={subject.id}
            className={cn(
              'group relative flex items-center gap-1 rounded-md',
              subject.id === activeSubjectId &&
                'bg-sidebar-accent before:bg-paper-rule before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full',
            )}
          >
            <button
              type="button"
              onClick={() => onSelect(subject.id)}
              className="flex flex-1 items-center justify-between gap-2 px-2.5 py-2 text-left text-sm"
            >
              <span
                className={cn(subject.id === activeSubjectId && 'font-medium')}
              >
                {subject.name}
              </span>
              {subject.category_count > 0 ? (
                <span className="text-muted-foreground text-xs tabular-nums">
                  {subject.category_count}
                </span>
              ) : null}
            </button>
            <span className="flex items-center pr-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`${subject.name} adını dəyiş`}
                ref={(el) => {
                  if (el) editButtonRefs.current.set(subject.id, el)
                  else editButtonRefs.current.delete(subject.id)
                }}
                onClick={() => setEditingId(subject.id)}
              >
                <Pencil />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                aria-label={`${subject.name} sil`}
                onClick={() => setPendingDelete(subject)}
              >
                <Trash2 />
              </Button>
            </span>
          </div>
        ),
      )}

      {adding ? (
        <div className="py-1">
          <NameForm
            placeholder="Fənnin adı"
            isPending={createSubject.isPending}
            onCancel={stopAdding}
            onSubmit={(name) =>
              createSubject.mutate(
                { programId, name },
                { onSuccess: stopAdding },
              )
            }
          />
        </div>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="mt-1 justify-start"
          ref={addButtonRef}
          onClick={() => setAdding(true)}
        >
          <Plus data-icon="inline-start" />
          Fənn əlavə et
        </Button>
      )}

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleteSubject.isPending) setPendingDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              «{pendingDelete?.name}» silinsin?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete && pendingDelete.category_count > 0
                ? `İçindəki ${pendingDelete.category_count} kateqoriya da silinəcək. Bu əməliyyat geri qaytarıla bilməz.`
                : 'Bu əməliyyat geri qaytarıla bilməz.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteSubject.isPending}>
              İmtina
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteSubject.isPending}
              onClick={(event) => {
                event.preventDefault()
                if (!pendingDelete) return
                deleteSubject.mutate(
                  { programId, id: pendingDelete.id },
                  { onSuccess: () => setPendingDelete(null) },
                )
              }}
            >
              {deleteSubject.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : null}
              Sil
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

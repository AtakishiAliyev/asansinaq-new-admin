import { useState } from 'react'
import {
  Check,
  ChevronDown,
  Pencil,
  Plus,
  Settings2,
  Trash2,
} from 'lucide-react'
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  useCreateProgram,
  useDeleteProgram,
  usePrograms,
  useRenameProgram,
} from '@/features/taxonomy/api/programs'
import { NameForm } from '@/features/taxonomy/components/name-form'
import type { Program } from '@/features/taxonomy/schemas'

interface ProgramMenuProps {
  programs: Program[]
  activeProgramId: number | null
  onSelect: (id: number) => void
}

function ManageProgramsDialog() {
  const programs = usePrograms()
  const createProgram = useCreateProgram()
  const renameProgram = useRenameProgram()
  const deleteProgram = useDeleteProgram()
  const [editingId, setEditingId] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<Program | null>(null)

  return (
    <DialogContent
      className="max-w-sm"
      // Radix hears Escape on document in the capture phase, so the inline
      // NameForm's own handler can't stop it — cancel the edit here instead
      // of letting Escape close the whole dialog mid-edit.
      onEscapeKeyDown={(event) => {
        if (editingId !== null || adding) {
          event.preventDefault()
          setEditingId(null)
          setAdding(false)
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>Proqramlar</DialogTitle>
        <DialogDescription>
          İmtahan sistemləri — hər proqramın öz fənn və kateqoriyaları var.
          Silmək üçün əvvəlcə onun fənlərini silin.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-1">
        {(programs.data ?? []).map((program) =>
          editingId === program.id ? (
            <div key={program.id} className="py-1">
              <NameForm
                defaultName={program.name}
                placeholder="Proqramın adı"
                isPending={renameProgram.isPending}
                onCancel={() => setEditingId(null)}
                onSubmit={(name) =>
                  renameProgram.mutate(
                    { id: program.id, name },
                    { onSuccess: () => setEditingId(null) },
                  )
                }
              />
            </div>
          ) : (
            <div
              key={program.id}
              className="group flex items-center justify-between gap-2 rounded-md px-2 py-1.5"
            >
              <span className="text-sm font-medium">{program.name}</span>
              <span className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`${program.name} adını dəyiş`}
                  onClick={() => setEditingId(program.id)}
                >
                  <Pencil />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  aria-label={`${program.name} sil`}
                  onClick={() => setPendingDelete(program)}
                >
                  <Trash2 />
                </Button>
              </span>
            </div>
          ),
        )}
      </div>

      {adding ? (
        <NameForm
          placeholder="Yeni proqramın adı (məs. SAT)"
          isPending={createProgram.isPending}
          onCancel={() => setAdding(false)}
          onSubmit={(name) =>
            createProgram.mutate(name, { onSuccess: () => setAdding(false) })
          }
        />
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => setAdding(true)}
        >
          <Plus data-icon="inline-start" />
          Proqram əlavə et
        </Button>
      )}

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleteProgram.isPending) setPendingDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              «{pendingDelete?.name}» silinsin?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Proqramın fənləri varsa, əvvəlcə onlar silinməlidir. Bu əməliyyat
              geri qaytarıla bilməz.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteProgram.isPending}>
              İmtina
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteProgram.isPending}
              onClick={(event) => {
                event.preventDefault()
                if (!pendingDelete) return
                deleteProgram.mutate(pendingDelete.id, {
                  onSuccess: () => setPendingDelete(null),
                })
              }}
            >
              {deleteProgram.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : null}
              Sil
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DialogContent>
  )
}

export function ProgramMenu({
  programs,
  activeProgramId,
  onSelect,
}: ProgramMenuProps) {
  const active = programs.find((p) => p.id === activeProgramId)

  return (
    <div className="flex items-center gap-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <span className="text-muted-foreground">Proqram:</span>
            {active?.name ?? '—'}
            <ChevronDown data-icon="inline-end" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            {programs.map((program) => (
              <DropdownMenuItem
                key={program.id}
                onSelect={() => onSelect(program.id)}
              >
                {program.name}
                {program.id === activeProgramId ? (
                  <Check className="ml-auto" />
                ) : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog>
        <DialogTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Proqramları idarə et"
          >
            <Settings2 />
          </Button>
        </DialogTrigger>
        <ManageProgramsDialog />
      </Dialog>
    </div>
  )
}

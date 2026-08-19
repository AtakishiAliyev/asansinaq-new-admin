import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { usePrograms } from '@/features/taxonomy'
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
import { BookFormFields } from '@/features/books/components/book-form-fields'
import { bookFormSchema, type BookFormValues } from '@/features/books/schemas'

interface BookFormDialogProps {
  open: boolean
  title: string
  description?: string
  submitLabel: string
  defaults: BookFormValues
  isPending: boolean
  onSubmit: (values: BookFormValues) => void
  onCancel: () => void
}

// One dialog for both create-at-upload and edit. Remounted via `key` by the
// callers whenever `defaults` change, so the form state always starts fresh.
export function BookFormDialog({
  open,
  title,
  description,
  submitLabel,
  defaults,
  isPending,
  onSubmit,
  onCancel,
}: BookFormDialogProps) {
  const {
    control,
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<BookFormValues>({
    resolver: zodResolver(bookFormSchema),
    defaultValues: defaults,
  })
  const [programId, setProgramId] = useState<number | null>(
    defaults.program_id || null,
  )

  // A single program (today: only YÖS) should not cost a click on every upload.
  const programs = usePrograms()
  useEffect(() => {
    const only = programs.data?.length === 1 ? programs.data[0] : undefined
    if (programId === null && only) {
      setValue('program_id', only.id)
      setProgramId(only.id)
    }
  }, [programId, programs.data, setValue])

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !isPending) onCancel()
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={handleSubmit((values) => onSubmit(values))}
        >
          <BookFormFields
            control={control}
            register={register}
            errors={errors}
            programId={programId}
            onProgramChange={(id) => {
              setProgramId(id)
              setValue('subject_id', null)
            }}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={onCancel}
              disabled={isPending}
            >
              İmtina
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? <Spinner data-icon="inline-start" /> : null}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { StemText, Tex } from '@/components/question/tex'
import type { QuestionListItem } from '@/features/questions/api/questions'
import { parseOptions } from '@/features/questions/lib/row'

const LABELS = ['A', 'B', 'C', 'D', 'E'] as const

const editFormSchema = z.object({
  stem: z.string().trim().min(1, 'Sual mətni boş ola bilməz'),
  options: z.array(z.string()).length(5),
})

type EditFormValues = z.infer<typeof editFormSchema>

// Structured fields with live KaTeX preview — never a raw JSON textarea:
// the reviewer fixes a comma, not a wire format.
export function QuestionEditForm({
  question,
  isPending,
  onCancel,
  onSubmit,
}: {
  question: QuestionListItem
  isPending: boolean
  onCancel: () => void
  onSubmit: (values: {
    stem: string
    options: { label: string; tex?: string; image?: string }[]
  }) => void
}) {
  const current = parseOptions(question.options)
  const form = useForm<EditFormValues>({
    resolver: zodResolver(editFormSchema),
    defaultValues: {
      stem: question.stem ?? '',
      options: LABELS.map(
        (label) => current.find((o) => o.label === label)?.tex ?? '',
      ),
    },
  })
  const values = form.watch()

  return (
    <Dialog open onOpenChange={(next) => (!next && !isPending ? onCancel() : undefined)}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-3 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Sualı redaktə et</DialogTitle>
          <DialogDescription>
            Riyaziyyat $...$ arasında yazılır. Dəyişiklik saxlanılanda müstəqil
            təsdiq statusu sıfırlanır.
          </DialogDescription>
        </DialogHeader>

        <form
          id="question-edit"
          className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto"
          onSubmit={form.handleSubmit((v) =>
            onSubmit({
              stem: v.stem,
              options: LABELS.map((label, i) => {
                const existing = current.find((o) => o.label === label)
                const tex = v.options[i].trim()
                return {
                  label,
                  ...(tex ? { tex } : {}),
                  ...(existing?.image ? { image: existing.image } : {}),
                }
              }),
            }),
          )}
        >
          <Field data-invalid={form.formState.errors.stem ? true : undefined}>
            <FieldLabel htmlFor="stem">Sual mətni</FieldLabel>
            <Textarea id="stem" rows={5} {...form.register('stem')} />
            {form.formState.errors.stem ? (
              <p className="text-destructive text-sm">
                {form.formState.errors.stem.message}
              </p>
            ) : null}
            <div className="bg-muted/30 rounded-md border p-3">
              <StemText text={values.stem ?? ''} />
            </div>
          </Field>

          <div className="grid gap-2 sm:grid-cols-2">
            {LABELS.map((label, i) => {
              const hasImage = Boolean(current.find((o) => o.label === label)?.image)
              return (
                <Field key={label}>
                  <FieldLabel htmlFor={`option-${label}`}>
                    {label} variantı{hasImage ? ' (şəkilli)' : ''}
                  </FieldLabel>
                  <Input
                    id={`option-${label}`}
                    disabled={hasImage}
                    {...form.register(`options.${i}` as const)}
                  />
                  {!hasImage && values.options?.[i] ? (
                    <div className="bg-muted/30 rounded-md border px-2 py-1 text-sm">
                      <Tex tex={values.options[i]} />
                    </div>
                  ) : null}
                </Field>
              )
            })}
          </div>
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isPending}>
            İmtina
          </Button>
          <Button type="submit" form="question-edit" disabled={isPending}>
            {isPending ? <Spinner data-icon="inline-start" /> : null}
            Yadda saxla
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

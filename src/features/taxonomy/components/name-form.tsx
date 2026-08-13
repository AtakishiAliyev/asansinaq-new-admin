import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Field, FieldError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { nameFormSchema, type NameFormValues } from '@/features/taxonomy/schemas'

interface NameFormProps {
  defaultName?: string
  placeholder: string
  isPending: boolean
  onSubmit: (name: string) => void
  onCancel: () => void
  autoFocus?: boolean
}

// The one inline editor used for every create/rename in the taxonomy UI:
// Enter saves, Esc cancels. Kept inline (no dialog) because an admin entering
// a book's worth of categories does it in bursts.
export function NameForm({
  defaultName = '',
  placeholder,
  isPending,
  onSubmit,
  onCancel,
  autoFocus = true,
}: NameFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<NameFormValues>({
    resolver: zodResolver(nameFormSchema),
    defaultValues: { name: defaultName },
  })

  return (
    <form
      className="flex flex-1 items-start gap-2"
      onSubmit={handleSubmit((values) => onSubmit(values.name))}
    >
      <Field className="flex-1" data-invalid={errors.name ? true : undefined}>
        <Input
          {...register('name')}
          placeholder={placeholder}
          autoFocus={autoFocus}
          disabled={isPending}
          aria-label={placeholder}
          aria-invalid={errors.name ? true : undefined}
          className="h-8"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              onCancel()
            }
          }}
        />
        <FieldError errors={[errors.name]} />
      </Field>
      <Button type="submit" size="sm" disabled={isPending}>
        {isPending ? <Spinner data-icon="inline-start" /> : null}
        Saxla
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={onCancel}
        disabled={isPending}
      >
        İmtina
      </Button>
    </form>
  )
}

import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { authErrorMessage } from '@/features/auth/auth-error-message'
import { emailFormSchema, type EmailFormValues } from '@/features/auth/schemas'

interface EmailStepProps {
  email: string
  isSent: boolean
  isPending: boolean
  error: unknown
  onSubmit: (email: string) => void
  onEdit: () => void
}

export function EmailStep({
  email,
  isSent,
  isPending,
  error,
  onSubmit,
  onEdit,
}: EmailStepProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<EmailFormValues>({
    resolver: zodResolver(emailFormSchema),
    defaultValues: { email },
  })

  if (isSent) {
    return (
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-sm">{email}</span>
        <Button type="button" variant="ghost" size="sm" onClick={onEdit}>
          Dəyiş
        </Button>
      </div>
    )
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={handleSubmit((values) => onSubmit(values.email))}
    >
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{authErrorMessage(error)}</AlertDescription>
        </Alert>
      ) : null}

      <Field data-invalid={errors.email ? true : undefined}>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          autoFocus
          placeholder="ad@example.com"
          aria-label="Email ünvanı"
          aria-invalid={errors.email ? true : undefined}
          {...register('email')}
        />
        <FieldError errors={[errors.email]} />
      </Field>

      <Button type="submit" disabled={isPending}>
        {isPending ? <Spinner data-icon="inline-start" /> : null}
        Kod göndər
      </Button>
    </form>
  )
}

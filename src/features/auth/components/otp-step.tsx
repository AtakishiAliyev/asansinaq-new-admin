import { useEffect, useRef } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm } from 'react-hook-form'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError } from '@/components/ui/field'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import { Spinner } from '@/components/ui/spinner'
import { authErrorMessage } from '@/features/auth/auth-error-message'
import {
  OTP_LENGTH,
  otpFormSchema,
  type OtpFormValues,
} from '@/features/auth/schemas'

const ERROR_ID = 'token-error'

interface OtpStepProps {
  isActive: boolean
  isPending: boolean
  isResending: boolean
  resendRemaining: number
  error: unknown
  resendError: unknown
  onSubmit: (token: string) => void
  onResend: () => void
}

export function OtpStep({
  isActive,
  isPending,
  isResending,
  resendRemaining,
  error,
  resendError,
  onSubmit,
  onResend,
}: OtpStepProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<OtpFormValues>({
    resolver: zodResolver(otpFormSchema),
    defaultValues: { token: '' },
  })

  // The step is rendered from the start so the whole flow is visible, so focus
  // has to move here when it opens rather than on mount.
  useEffect(() => {
    if (isActive) inputRef.current?.focus()
  }, [isActive])

  // A rejected code must be cleared, not left in place: input-otp only fires
  // onComplete on a 5→6 transition, so a full field of dead digits would never
  // auto-submit again and the button would just resend the same wrong code.
  useEffect(() => {
    if (!error) return
    reset({ token: '' })
    inputRef.current?.focus()
  }, [error, reset])

  const invalid = errors.token ? true : undefined
  const describedBy = errors.token || error ? ERROR_ID : undefined

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={handleSubmit((values) => onSubmit(values.token))}
    >
      {error ? (
        <Alert variant="destructive">
          <AlertDescription id={ERROR_ID}>
            {authErrorMessage(error)}
          </AlertDescription>
        </Alert>
      ) : null}

      <Field data-invalid={invalid}>
        <Controller
          control={control}
          name="token"
          render={({ field }) => (
            <InputOTP
              id="token"
              maxLength={OTP_LENGTH}
              disabled={!isActive || isPending}
              aria-label="Giriş kodu"
              aria-invalid={invalid}
              aria-describedby={describedBy}
              value={field.value}
              onChange={field.onChange}
              onComplete={() => void handleSubmit((v) => onSubmit(v.token))()}
              onBlur={field.onBlur}
              ref={(element) => {
                field.ref(element)
                inputRef.current = element
              }}
            >
              <InputOTPGroup>
                {Array.from({ length: OTP_LENGTH }, (_, index) => (
                  // Also on the slots: the group's has-aria-invalid styling
                  // matches descendants, and the real input is its sibling.
                  <InputOTPSlot key={index} index={index} aria-invalid={invalid} />
                ))}
              </InputOTPGroup>
            </InputOTP>
          )}
        />
        {isActive ? (
          <FieldError id={ERROR_ID} errors={[errors.token]} />
        ) : (
          <FieldDescription>
            Kod göndəriləndən sonra aktivləşir.
          </FieldDescription>
        )}
      </Field>

      {isActive ? (
        <div className="flex flex-col gap-3">
          <Button type="submit" disabled={isPending}>
            {isPending ? <Spinner data-icon="inline-start" /> : null}
            Daxil ol
          </Button>

          {resendError ? (
            <Alert variant="destructive">
              <AlertDescription>{authErrorMessage(resendError)}</AlertDescription>
            </Alert>
          ) : null}

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={onResend}
            disabled={isPending || isResending || resendRemaining > 0}
          >
            {isResending ? <Spinner data-icon="inline-start" /> : null}
            {resendRemaining > 0
              ? `Kodu yenidən göndər — ${resendRemaining} san`
              : 'Kodu yenidən göndər'}
          </Button>
        </div>
      ) : null}
    </form>
  )
}

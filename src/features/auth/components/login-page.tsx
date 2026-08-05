import { useState } from 'react'
import { Navigate } from 'react-router'
import { Card, CardContent } from '@/components/ui/card'
import { FullPageSpinner } from '@/components/full-page-spinner'
import { useAuth } from '@/hooks/use-auth'
import { useRequestOtp } from '@/features/auth/api/use-request-otp'
import { useVerifyOtp } from '@/features/auth/api/use-verify-otp'
import { EmailStep } from '@/features/auth/components/email-step'
import { LoginStep } from '@/features/auth/components/login-step'
import { OtpStep } from '@/features/auth/components/otp-step'
import { useCooldown } from '@/features/auth/hooks/use-cooldown'

// Matches smtp_max_frequency on the Supabase project.
const RESEND_COOLDOWN_SECONDS = 20

type Step = { name: 'email'; email: string } | { name: 'otp'; email: string }

export function LoginPage() {
  const { status } = useAuth()
  const [step, setStep] = useState<Step>({ name: 'email', email: '' })
  const requestOtp = useRequestOtp()
  const verifyOtp = useVerifyOtp()
  const cooldown = useCooldown(RESEND_COOLDOWN_SECONDS)

  if (status === 'loading') return <FullPageSpinner />
  if (status === 'signed-in') return <Navigate to="/" replace />

  const isSent = step.name === 'otp'

  // Only a delivered email starts the cooldown, so a rejected send does not
  // lock the button for 20 seconds.
  function sendCode(email: string) {
    requestOtp.mutate(email, {
      onSuccess: () => {
        cooldown.start()
        setStep({ name: 'otp', email })
      },
    })
  }

  function handleVerify(token: string) {
    if (verifyOtp.isPending) return
    verifyOtp.mutate({ email: step.email, token })
  }

  function handleEditEmail() {
    verifyOtp.reset()
    requestOtp.reset()
    setStep({ name: 'email', email: step.email })
  }

  return (
    <div className="bg-secondary paper-grid flex min-h-screen items-center justify-center p-6">
      <div className="flex w-full max-w-md flex-col gap-8">
        <header className="flex flex-col gap-1.5">
          <p className="text-muted-foreground font-mono text-xs tracking-[0.18em] uppercase">
            Admin paneli
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">Asansinaq</h1>
        </header>

        <Card>
          <CardContent>
            <ol className="relative flex flex-col gap-7">
              <span
                aria-hidden
                className="bg-paper-rule/60 absolute inset-y-0 left-11 w-px"
              />

              <LoginStep
                number={1}
                title="Email ünvanı"
                state={isSent ? 'done' : 'active'}
              >
                <EmailStep
                  email={step.email}
                  isSent={isSent}
                  isPending={requestOtp.isPending}
                  error={isSent ? null : requestOtp.error}
                  onSubmit={sendCode}
                  onEdit={handleEditEmail}
                />
              </LoginStep>

              <LoginStep
                number={2}
                title="Giriş kodu"
                state={isSent ? 'active' : 'waiting'}
              >
                <OtpStep
                  isActive={isSent}
                  isPending={verifyOtp.isPending}
                  isResending={requestOtp.isPending}
                  resendRemaining={cooldown.remaining}
                  error={verifyOtp.error}
                  resendError={requestOtp.error}
                  onSubmit={handleVerify}
                  onResend={() => sendCode(step.email)}
                />
              </LoginStep>
            </ol>
          </CardContent>
        </Card>

        <p className="text-muted-foreground text-xs">
          Giriş yalnız icazə verilmiş hesablar üçündür. Kod 15 dəqiqə
          etibarlıdır.
        </p>
      </div>
    </div>
  )
}

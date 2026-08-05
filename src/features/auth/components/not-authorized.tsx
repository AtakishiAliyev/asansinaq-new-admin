import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/use-auth'
import { useSignOut } from '@/features/auth/api/use-sign-out'

export function NotAuthorized() {
  const { session } = useAuth()
  const signOut = useSignOut()

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="flex w-full max-w-sm flex-col gap-4">
        <Alert variant="destructive">
          <AlertTitle>Giriş icazəsi yoxdur</AlertTitle>
          <AlertDescription>
            {session?.user.email} ünvanı admin siyahısında deyil.
          </AlertDescription>
        </Alert>
        <Button
          variant="outline"
          onClick={() => signOut.mutate()}
          disabled={signOut.isPending}
        >
          Çıxış et
        </Button>
      </div>
    </main>
  )
}

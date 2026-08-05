import { Navigate, Outlet } from 'react-router'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { FullPageSpinner } from '@/components/full-page-spinner'
import { useAuth } from '@/hooks/use-auth'
import { NotAuthorized, useIsAdmin, useSignOut } from '@/features/auth'

// The single route guard. Individual pages never repeat these checks.
export function ProtectedLayout() {
  const { status } = useAuth()
  const isAdmin = useIsAdmin()
  const signOut = useSignOut()

  if (status === 'loading') return <FullPageSpinner />
  if (status === 'signed-out') return <Navigate to="/login" replace />
  if (isAdmin.isPending) return <FullPageSpinner />

  if (isAdmin.isError) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <div className="flex w-full max-w-sm flex-col gap-4">
          <Alert variant="destructive">
            <AlertTitle>Giriş icazəsi yoxlanıla bilmədi</AlertTitle>
            <AlertDescription>
              Serverlə əlaqə alınmadı. Bir azdan yenidən cəhd edin.
            </AlertDescription>
          </Alert>
          <div className="flex gap-2">
            <Button
              onClick={() => void isAdmin.refetch()}
              disabled={isAdmin.isFetching}
            >
              Yenidən cəhd et
            </Button>
            <Button
              variant="outline"
              onClick={() => signOut.mutate()}
              disabled={signOut.isPending}
            >
              Çıxış et
            </Button>
          </div>
        </div>
      </main>
    )
  }

  if (!isAdmin.data) return <NotAuthorized />

  return <Outlet />
}

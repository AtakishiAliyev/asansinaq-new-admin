import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/use-auth'
import { useSignOut } from '@/features/auth'

export function HomePage() {
  const { session } = useAuth()
  const signOut = useSignOut()

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-semibold">Asansinaq Admin</h1>
      <p className="text-muted-foreground text-sm">{session?.user.email}</p>
      <Button
        variant="outline"
        onClick={() => signOut.mutate()}
        disabled={signOut.isPending}
      >
        Çıxış et
      </Button>
    </div>
  )
}

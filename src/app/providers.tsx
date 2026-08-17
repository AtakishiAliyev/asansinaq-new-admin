import { type ReactNode, useEffect, useRef } from 'react'
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from '@tanstack/react-query'
import { Toaster } from '@/components/ui/sonner'
import { useAuth } from '@/hooks/use-auth'
import { clearIsAdminFlag } from '@/features/auth'
import { initAuth } from '@/stores/auth-store'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
    },
  },
})

// Cached rows belong to the account that fetched them. This watches the account
// itself rather than the sign-out mutation, because a session also ends through
// paths that mutation never sees: an expired refresh token, a deleted user, or
// a sign-out in another tab.
function useResetCacheOnAccountChange() {
  const queryClient = useQueryClient()
  const { session } = useAuth()
  const userId = session?.user.id ?? null
  const previousUserId = useRef(userId)

  useEffect(() => {
    const previous = previousUserId.current
    if (previous === userId) return
    previousUserId.current = userId
    // null → id is session restore on startup (or a fresh sign-in into an
    // empty cache), not an account change: clearing here would cancel the
    // just-started is_admin fetch on every reload and restart it.
    if (previous === null) return
    clearIsAdminFlag(previous)
    queryClient.clear()
  }, [queryClient, userId])
}

function AuthCacheBoundary({ children }: { children: ReactNode }) {
  useResetCacheOnAccountChange()
  return children
}

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => initAuth(), [])

  return (
    <QueryClientProvider client={queryClient}>
      <AuthCacheBoundary>{children}</AuthCacheBoundary>
      <Toaster />
    </QueryClientProvider>
  )
}

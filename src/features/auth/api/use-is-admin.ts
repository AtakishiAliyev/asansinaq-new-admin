import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/hooks/use-auth'
import { supabase } from '@/lib/supabase'
import { authKeys } from '@/features/auth/api/keys'
import { isAdminSchema } from '@/features/auth/schemas'

// Last verdict per user, so a reload paints the shell instantly instead of
// blocking full-screen on the RPC. UX only — RLS remains the boundary; a
// revoked admin sees at most ~1 RTT of data-free chrome before NotAuthorized.
const FLAG_PREFIX = 'asansinaq:is-admin:'

function readIsAdminFlag(userId: string): boolean | undefined {
  try {
    const raw = localStorage.getItem(FLAG_PREFIX + userId)
    return raw === null ? undefined : raw === '1'
  } catch {
    return undefined
  }
}

function writeIsAdminFlag(userId: string, isAdmin: boolean) {
  try {
    localStorage.setItem(FLAG_PREFIX + userId, isAdmin ? '1' : '0')
  } catch {
    // private mode / full storage: reloads just fall back to the spinner
  }
}

export function clearIsAdminFlag(userId: string) {
  try {
    localStorage.removeItem(FLAG_PREFIX + userId)
  } catch {
    // nothing to clean up if storage is unavailable
  }
}

async function fetchIsAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_admin')
  if (error) throw error
  return isAdminSchema.parse(data)
}

// A signed-in user who is not on the allowlist sees an explicit refusal rather
// than an empty panel, which RLS alone would produce.
export function useIsAdmin() {
  const { session } = useAuth()
  const userId = session?.user.id

  return useQuery({
    queryKey: authKeys.isAdmin(userId ?? 'anonymous'),
    queryFn: async () => {
      const isAdmin = await fetchIsAdmin()
      if (userId) writeIsAdminFlag(userId, isAdmin)
      return isAdmin
    },
    enabled: Boolean(userId),
    // Seeded from the stored verdict but stamped stale (updatedAt 0), so the
    // gate revalidates in the background on every mount — a revoked admin
    // loses the shell on the next response, matching the allowlist's
    // "revokes on the next request" semantics.
    initialData: userId ? () => readIsAdminFlag(userId) : undefined,
    initialDataUpdatedAt: 0,
    // This query blocks the whole screen when cold: the default 3-retry
    // exponential backoff would hold the spinner for ~7s on a flaky first
    // request. One quick retry, then the error UI with its manual retry.
    retry: 1,
    retryDelay: 500,
  })
}

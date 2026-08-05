import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/hooks/use-auth'
import { supabase } from '@/lib/supabase'
import { authKeys } from '@/features/auth/api/keys'
import { isAdminSchema } from '@/features/auth/schemas'

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
    queryFn: fetchIsAdmin,
    enabled: Boolean(userId),
  })
}

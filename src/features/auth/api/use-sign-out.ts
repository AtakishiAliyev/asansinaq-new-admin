import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { authErrorMessage } from '@/features/auth/auth-error-message'

// Clearing the query cache is deliberately NOT done here — it is bound to the
// account transition in Providers, which also covers sign-outs this mutation
// never runs (expired token, deleted user, another tab).
export function useSignOut() {
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
    },
    onError: (error) => toast.error(authErrorMessage(error)),
  })
}

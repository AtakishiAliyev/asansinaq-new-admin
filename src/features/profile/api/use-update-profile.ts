import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '@/hooks/use-auth'
import { normalizeError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { profileKeys } from '@/features/profile/api/keys'

export function useUpdateProfile() {
  const queryClient = useQueryClient()
  const { session } = useAuth()
  const userId = session?.user.id

  return useMutation({
    mutationFn: async (fullName: string) => {
      if (!userId) throw new Error('no session')
      const { error } = await supabase
        .from('profiles')
        .update({ full_name: fullName })
        .eq('id', userId)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Profil yeniləndi')
      void queryClient.invalidateQueries({
        queryKey: profileKeys.detail(userId ?? 'anonymous'),
      })
    },
    onError: (error) => toast.error(normalizeError(error).message),
  })
}

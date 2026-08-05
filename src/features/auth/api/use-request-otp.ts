import { useMutation } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// shouldCreateUser: false is the first allowlist gate — an unknown address
// never receives a code. public.is_admin() is the one that actually secures
// data; this only avoids emailing strangers.
async function requestOtp(email: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: { shouldCreateUser: false },
  })
  if (error) throw error
}

export function useRequestOtp() {
  return useMutation({ mutationFn: requestOtp })
}

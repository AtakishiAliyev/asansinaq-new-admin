import { useMutation } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

interface VerifyOtpInput {
  email: string
  token: string
}

async function verifyOtp({ email, token }: VerifyOtpInput): Promise<void> {
  const { error } = await supabase.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token,
    type: 'email',
  })
  if (error) throw error
  // The session lands via onAuthStateChange; nothing to return.
}

export function useVerifyOtp() {
  return useMutation({ mutationFn: verifyOtp })
}

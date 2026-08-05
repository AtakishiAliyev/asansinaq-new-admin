import { type AuthState, useAuthStore } from '@/stores/auth-store'

// The only way components read auth state. Never call supabase.auth directly.
export function useAuth(): AuthState {
  return useAuthStore((store) => store.auth)
}

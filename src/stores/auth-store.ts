import type { Session } from '@supabase/supabase-js'
import { create } from 'zustand'
import { supabase } from '@/lib/supabase'

export type AuthState =
  | { status: 'loading'; session: null }
  | { status: 'signed-out'; session: null }
  | { status: 'signed-in'; session: Session }

// The union is held whole rather than spread across the store, so no partial
// write can produce a signed-in status with no session.
interface AuthStore {
  auth: AuthState
  setSession: (session: Session | null) => void
}

export const useAuthStore = create<AuthStore>()((set) => ({
  auth: { status: 'loading', session: null },
  setSession: (session) =>
    set({
      auth: session
        ? { status: 'signed-in', session }
        : { status: 'signed-out', session: null },
    }),
}))

// supabase-js emits INITIAL_SESSION on subscribe, so this single listener also
// resolves the initial `loading` state — no separate getSession() call that
// could land out of order with a sign-in that happens while it is in flight.
// Returns its own teardown so StrictMode's mount/cleanup/mount and Vite HMR
// both end with exactly one live listener writing to the current store.
export function initAuth() {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    useAuthStore.getState().setSession(session)
  })
  return () => data.subscription.unsubscribe()
}

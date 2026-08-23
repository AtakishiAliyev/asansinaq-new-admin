// The worker's Supabase client: service role, created once.
//
// Service role bypasses RLS, which is the whole reason it can do this job — it
// reads crops out of a private bucket and writes the ledger without a user
// session to resolve. It is also why nothing under src/ may ever import this
// file: the same key in a browser bundle would hand every visitor the database.
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { config } from './config.ts'

export const db = createClient<Database>(
  config.SUPABASE_URL,
  config.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      // A daemon has no session to persist and no token to refresh: the
      // service key is not a login.
      persistSession: false,
      autoRefreshToken: false,
    },
  },
)

export type Db = typeof db
export type QuestionRow = Database['public']['Tables']['questions']['Row']

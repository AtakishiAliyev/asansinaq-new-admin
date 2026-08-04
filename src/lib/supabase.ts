import { createClient } from '@supabase/supabase-js'
import { env } from '@/lib/env'

// Untyped until `npm run types:gen` generates src/types/database.ts —
// then switch to createClient<Database>.
export const supabase = createClient(
  env.VITE_SUPABASE_URL,
  env.VITE_SUPABASE_ANON_KEY,
)

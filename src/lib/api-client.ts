import axios from 'axios'

// External (non-Supabase) APIs only — Supabase calls go through @/lib/supabase.
export const apiClient = axios.create({
  timeout: 15_000,
})

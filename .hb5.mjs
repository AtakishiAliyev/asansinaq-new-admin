import { createClient } from '@supabase/supabase-js'
const db = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false} })
const { data } = await db.from('worker_heartbeat').select('*')
for (const r of data ?? []) {
  const age = Math.round((Date.now() - new Date(r.last_seen).getTime())/1000)
  console.log(`  ${r.worker_id}: activity="${r.activity}" age=${age}s stopped_at=${r.stopped_at ? 'set' : 'null'} -> UI: ${age<150 && !r.stopped_at ? 'ONLINE' : 'offline'}`)
}

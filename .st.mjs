import { createClient } from '@supabase/supabase-js'
const db = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false} })
const { count: inflight } = await db.from('questions').select('id',{count:'exact',head:true}).not('batch_id','is',null)
const { count: queued } = await db.from('questions').select('id',{count:'exact',head:true}).not('queued_at','is',null)
console.log(`in a batch: ${inflight}  queued: ${queued}`)
const { data } = await db.from('questions').select('id,page_number,q_no,verified,prompt_version,batch_stage').in('id',[525,526,529,537,550,553]).order('id')
for (const r of data??[]) console.log(`  id=${r.id} p${r.page_number}q${r.q_no} pv=${r.prompt_version} verified=${r.verified} stage=${r.batch_stage??'-'}`)

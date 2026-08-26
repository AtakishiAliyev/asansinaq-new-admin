import { createClient } from '@supabase/supabase-js'
const db = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false} })
const { data } = await db.from('questions')
  .select('id,page_number,q_no,verified,verify_confidence,prompt_version,repair_round,figures,flags')
  .in('id',[525,526,529,537,550,553]).order('id')
for (const r of data??[]) {
  const items = r.figures?.items ?? []
  const kinds = items.map(i=>i.kind).join('+') || 'none'
  const notable = (r.flags??[]).map(f=>f.code).filter(c=>['kind_over_reach','figure_box_unverified','venn_unknown_set','venn_parse','curve_invalid','verify_mismatch','raster_figure','repair_rejected'].includes(c))
  console.log(`id=${r.id} p${r.page_number}q${r.q_no}  pv=${r.prompt_version} rep=${r.repair_round}  ${kinds.padEnd(15)} verified=${String(r.verified).padEnd(5)} conf=${r.verify_confidence?.toFixed(2)??'-'}  ${[...new Set(notable)].join(',')||'—'}`)
  for (const it of items) if (it.kind==='image') console.log(`      image box=${JSON.stringify(it.box)} ${it.w}x${it.h} src=${it.src}`)
}

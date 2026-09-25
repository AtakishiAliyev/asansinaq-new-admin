// Round-trips the exam builder's database functions against the LIVE
// project: create an exam from a template, search and count the bank, page
// by keyset, draw a recipe, save a section, refuse an over-full or
// incomplete one, publish twice, and check the snapshot.
//
//   npm run smoke:exams
//
// Operator-run and outside the gate, like smoke:queue: it needs the network
// and the service key. It publishes figure-FREE questions only, so it copies
// nothing into the public bucket, and it deletes the exam it made — versions
// and snapshot go with it — whatever happens. Run it after any migration
// touching the exam tables or functions.
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../src/types/database.ts'
import { readEnvFile } from '../scripts/env-file.ts'
const env = { ...readEnvFile('.env'), ...process.env }
const sb = createClient<Database>(env.VITE_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const ok = (label: string, cond: boolean, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`)
let examId: number | null = null
try {
  const { data: tpls } = await sb.from('exam_templates').select('id,name,duration_seconds,base_score,exam_template_sections(position,question_count,points_correct,penalty_ratio,subject_id)').order('sort_order')
  ok('four YÖS templates seeded', tpls?.length === 4, tpls?.map((t) => `${t.name}:${t.exam_template_sections.length}sec`).join(' '))
  const full = tpls!.find((t) => t.name === 'Tam TR-YÖS')!
  const max = Number(full.base_score) + full.exam_template_sections.reduce((s, x) => s + x.question_count * Number(x.points_correct), 0)
  ok('full template max is 500', max === 500, String(max))
  const mat = tpls!.find((t) => t.name === 'Matematik')!
  const subject = mat.exam_template_sections[0]!.subject_id

  const { data: exam, error: ce } = await sb.rpc('exam_create', { p_template_id: mat.id })
  ok('exam_create', !ce && !!exam, ce?.message ?? `${exam?.title} seq=${exam?.seq}`)
  examId = exam!.id

  const { data: facets } = await sb.rpc('exam_question_facets', { p_subject_id: subject })
  const total = (facets ?? []).reduce((s, f) => s + Number(f.n), 0)
  ok('facets count the approved bank of the subject', total > 0, `${total} over ${facets?.length} cells`)

  const p1 = await sb.rpc('exam_question_search', { p_subject_id: subject, p_limit: 50 })
  const last = p1.data?.at(-1)?.id
  const p2 = await sb.rpc('exam_question_search', { p_subject_id: subject, p_limit: 50, p_after_id: last })
  ok('keyset pages do not overlap', !!p1.data?.length && !!p2.data?.length && p2.data![0]!.id > last!, `${p1.data?.length}+${p2.data?.length}`)

  const s = await sb.rpc('exam_question_search', { p_subject_id: subject, p_search: 'kaçtır', p_limit: 5 })
  ok('text search', !s.error && (s.data?.length ?? 0) > 0, s.error?.message ?? `${s.data?.length} hits`)
  const pct = await sb.rpc('exam_question_search', { p_subject_id: subject, p_search: '100%_x', p_limit: 5 })
  ok('wildcards in search are literal', !pct.error && pct.data?.length === 0, pct.error?.message ?? `${pct.data?.length}`)

  const nofig = await sb.rpc('exam_question_search', { p_subject_id: subject, p_figures: 'without', p_limit: 200 })
  const cats = [...new Set((facets ?? []).map((f) => f.category_id))]
  const cells = cats.map((c) => ({ category_id: c, difficulty: null, count: 3 }))
  const pick = await sb.rpc('exam_autofill_pick', { p_exam_id: examId, p_cells: cells, p_unused_only: true })
  const pickedIds = (pick.data ?? []).map((r) => r.question_id)
  ok('autofill draws distinct questions', !pick.error && new Set(pickedIds).size === pickedIds.length && pickedIds.length > 0, pick.error?.message ?? `${pickedIds.length} for ${cells.length} topics`)

  // Publish needs rendered figures for figure questions; the smoke test uses figure-free ones.
  const thirty = (nofig.data ?? []).slice(0, 30).map((r) => r.id)
  const tooMany = await sb.rpc('exam_set_items', { p_exam_id: examId, p_section_position: 1, p_question_ids: (nofig.data ?? []).slice(0, 31).map((r) => r.id) })
  ok('a section refuses more than its count', !!tooMany.error, tooMany.error?.message)
  const half = await sb.rpc('exam_set_items', { p_exam_id: examId, p_section_position: 1, p_question_ids: thirty.slice(0, 20) })
  ok('exam_set_items saves a partial section', !half.error, half.error?.message)
  const early = await sb.rpc('exam_publish', { p_exam_id: examId })
  ok('publish refuses an incomplete section', !!early.error, early.error?.message)

  const full30 = await sb.rpc('exam_set_items', { p_exam_id: examId, p_section_position: 1, p_question_ids: thirty })
  ok('exam_set_items saves 30', !full30.error, full30.error?.message)
  const draft = await sb.rpc('exam_draft_items', { p_exam_id: examId })
  ok('exam_draft_items returns the order saved', draft.data?.map((d) => d.question_id).join() === thirty.join(), `${draft.data?.length}`)

  const pub = await sb.rpc('exam_publish', { p_exam_id: examId })
  ok('exam_publish', !pub.error && pub.data?.version_no === 1, pub.error?.message ?? `v${pub.data?.version_no} max=${pub.data?.max_score} q=${pub.data?.question_count}`)
  const { data: vitems } = await sb.from('exam_version_items').select('seq,answer,options').eq('version_id', pub.data!.id).order('seq')
  ok('snapshot has 30 rows in order', vitems?.length === 30 && vitems[0]!.seq === 1 && vitems.at(-1)!.seq === 30)
  ok('snapshot options are clean', (vitems ?? []).every((v) => Array.isArray(v.options) && (v.options as any[]).every((o) => Object.keys(o).every((k) => ['label', 'tex', 'image_url'].includes(k)))))
  const pub2 = await sb.rpc('exam_publish', { p_exam_id: examId })
  ok('republishing makes version 2', pub2.data?.version_no === 2, pub2.error?.message)
  const { data: e2 } = await sb.from('exams').select('current_version_id').eq('id', examId).single()
  ok('exam points at the newest version', e2?.current_version_id === pub2.data?.id)
} finally {
  if (examId) {
    const { error } = await sb.from('exams').delete().eq('id', examId)
    console.log(error ? `CLEANUP FAILED: ${error.message}` : `cleaned up exam ${examId}`)
  }
}

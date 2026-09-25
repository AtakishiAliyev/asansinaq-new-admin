// Round-trips a student's sitting of a deneme against the LIVE project, as a
// throwaway student: start, answer, flag, the heartbeat clock, pause, resume,
// hand in, the score, a retake, and the one-open-attempt rule.
//
//   npm run smoke:attempts
//
// Operator-run and outside the gate, like smoke:exams. It publishes a
// figure-free exam, sits it with a probe student, checks the score against
// the version's rules by hand, and deletes the exam and the student whatever
// happens.
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../src/types/database.ts'
import { readEnvFile } from './env-file.ts'

const env = { ...readEnvFile('.env'), ...process.env }
const url = env.VITE_SUPABASE_URL!
const admin = createClient<Database>(url, env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const EMAIL = 'ui-probe+attempt@asansinaq.test'
const MARK = '[smoke] '
let failed = 0
const ok = (label: string, cond: boolean, extra = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`)
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const examIds: number[] = []
let uid: string | undefined
try {
  // ── a published, visible Matematik exam ────────────────────────────────
  const { data: tpl } = await admin.from('exam_templates').select('id, exam_template_sections(subject_id)').eq('name', 'Matematik').single()
  const subject = tpl!.exam_template_sections[0]!.subject_id
  const makeExam = async () => {
    const { data: exam, error } = await admin.rpc('exam_create', { p_template_id: tpl!.id })
    if (error) throw error
    examIds.push(exam.id)
    await admin.from('exams').update({ title: `${MARK}${exam.title}` }).eq('id', exam.id)
    const { data: pool } = await admin.rpc('exam_question_search', { p_subject_id: subject, p_figures: 'without', p_limit: 60, p_after_id: examIds.length * 100 })
    await admin.rpc('exam_set_items', { p_exam_id: exam.id, p_section_position: 1, p_question_ids: pool!.slice(0, 30).map((q) => q.id) })
    const { error: pe } = await admin.rpc('exam_publish', { p_exam_id: exam.id })
    if (pe) throw pe
    await admin.from('exams').update({ is_visible: true }).eq('id', exam.id)
    return exam.id
  }
  const examA = await makeExam()
  const examB = await makeExam()

  // ── a probe student ────────────────────────────────────────────────────
  const { data: made } = await admin.auth.admin.createUser({ email: EMAIL, email_confirm: true })
  uid = made.user!.id
  await admin.from('profiles').update({ full_name: 'Smoke', goal_score: 450, grade: '11', onboarded_at: new Date().toISOString(), level: 'intermediate', placement_at: new Date().toISOString() }).eq('id', uid)
  const student = createClient<Database>(url, env.VITE_SUPABASE_ANON_KEY!, { auth: { persistSession: false } })
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email: EMAIL })
  const v = await student.auth.verifyOtp({ email: EMAIL, token: link!.properties.email_otp, type: 'email' })
  ok('student signed in', !v.error, v.error?.message)

  // ── start ──────────────────────────────────────────────────────────────
  const none = await student.rpc('attempt_current')
  ok('no open attempt at first', !none.error && none.data === null, none.error?.message)
  const start = await student.rpc('attempt_start', { p_exam_id: examA })
  ok('attempt_start', !start.error, start.error?.message)
  const payload = start.data as any
  const attemptId = payload.attempt.id as number
  ok('30 questions, no answers in payload', payload.questions.length === 30 && !JSON.stringify(payload.questions).includes('"answer"'))
  ok('clock starts full', payload.attempt.remaining_seconds === 1800, String(payload.attempt.remaining_seconds))
  ok('sections carried', payload.attempt.sections?.[0]?.subject_name === 'Matematik')

  // ── the one-open rule ──────────────────────────────────────────────────
  const other = await student.rpc('attempt_start', { p_exam_id: examB })
  ok('cannot start another while one is open', !!other.error && /open_attempt:\d+/.test(other.error.message), other.error?.message)
  const again = await student.rpc('attempt_start', { p_exam_id: examA })
  ok('starting the same exam resumes it', !again.error && (again.data as any).attempt.id === attemptId)

  // ── answering, with the real key from the admin side ───────────────────
  const { data: key } = await admin.from('exam_version_items').select('seq, answer').eq('version_id', (await admin.from('exam_attempts').select('version_id').eq('id', attemptId).single()).data!.version_id).order('seq')
  const answerOf = (seq: number) => key!.find((k) => k.seq === seq)!.answer
  const wrongOf = (seq: number) => (answerOf(seq) === 'A' ? 'B' : 'A')
  // 20 right, 4 wrong, 6 blank → net 19, × 5.25 = 99.75
  for (let seq = 1; seq <= 20; seq++) {
    const r = await student.rpc('attempt_answer', { p_attempt_id: attemptId, p_seq: seq, p_choice: answerOf(seq) })
    if (r.error) throw r.error
  }
  for (let seq = 21; seq <= 24; seq++) await student.rpc('attempt_answer', { p_attempt_id: attemptId, p_seq: seq, p_choice: wrongOf(seq) })
  // change one, clear one, flag one
  await student.rpc('attempt_answer', { p_attempt_id: attemptId, p_seq: 25, p_choice: 'C' })
  await student.rpc('attempt_answer', { p_attempt_id: attemptId, p_seq: 25, p_choice: null })
  const flag = await student.rpc('attempt_flag', { p_attempt_id: attemptId, p_seq: 26, p_flagged: true })
  ok('flag', !flag.error, flag.error?.message)
  const bad = await student.rpc('attempt_answer', { p_attempt_id: attemptId, p_seq: 99, p_choice: 'A' })
  ok('out-of-range seq refused', !!bad.error)
  const badChoice = await student.rpc('attempt_answer', { p_attempt_id: attemptId, p_seq: 1, p_choice: 'Z' })
  ok('bad choice refused', !!badChoice.error)

  // ── the clock ──────────────────────────────────────────────────────────
  const b1 = await student.rpc('attempt_heartbeat', { p_attempt_id: attemptId, p_seq: 26 })
  await sleep(2100)
  const b2 = await student.rpc('attempt_heartbeat', { p_attempt_id: attemptId, p_seq: 26 })
  ok('heartbeat charges the gap', !b2.error && (b1.data ?? 0) - (b2.data ?? 0) >= 2 && (b1.data ?? 0) - (b2.data ?? 0) <= 4, `${b1.data} → ${b2.data}`)
  await student.rpc('attempt_pause', { p_attempt_id: attemptId, p_seq: 26 })
  // A long pause is not charged: pretend the last beat was an hour ago.
  await admin.from('exam_attempts').update({ last_seen_at: new Date(Date.now() - 3600_000).toISOString() }).eq('id', attemptId)
  const b3 = await student.rpc('attempt_heartbeat', { p_attempt_id: attemptId })
  ok('an hour away costs at most the cap', (b2.data ?? 0) - (b3.data ?? 0) <= 45, `${b2.data} → ${b3.data}`)
  const resumed = await student.rpc('attempt_current')
  ok('resume lands on the last question', (resumed.data as any)?.attempt.current_seq === 26 && Object.keys((resumed.data as any).responses).length === 26)

  // ── events and sketches ────────────────────────────────────────────────
  const ev = await student.rpc('attempt_events_add', { p_attempt_id: attemptId, p_events: [{ seq: 3, kind: 'open', at: new Date().toISOString() }, { seq: 3, kind: 'sketch_open', payload: { layer: 'board' } }] })
  ok('events accepted', !ev.error, ev.error?.message)
  const sk = await student.rpc('attempt_sketch_save', { p_attempt_id: attemptId, p_seq: 3, p_layer: 'board', p_data: { objects: [{ kind: 'stroke', points: [[0, 0], [1, 1]] }] } })
  const skl = await student.rpc('attempt_sketches_load', { p_attempt_id: attemptId })
  ok('sketch round-trips', !sk.error && (skl.data as any[])?.length === 1 && (skl.data as any[])[0].layer === 'board', sk.error?.message)

  // ── the student cannot read the tables ─────────────────────────────────
  const direct = await student.from('exam_attempts').select('score').limit(1)
  const items = await student.from('exam_version_items').select('answer').limit(1)
  ok('student reads nothing directly', direct.data?.length === 0 && items.data?.length === 0)
  const foreign = await student.rpc('attempt_answer', { p_attempt_id: attemptId + 100000, p_seq: 1, p_choice: 'A' })
  ok('someone else\'s attempt is refused', !!foreign.error)

  // ── hand in ────────────────────────────────────────────────────────────
  const sub = await student.rpc('attempt_submit', { p_attempt_id: attemptId })
  ok('submit', !sub.error, sub.error?.message)
  const res = sub.data as any
  ok('score is net × points: 20 right, 4 wrong → 19 × 5.25', Number(res.score) === 99.75, `${res.score} / ${res.max_score} c=${res.correct} w=${res.wrong} b=${res.blank}`)
  ok('counts', res.correct === 20 && res.wrong === 4 && res.blank === 6)
  ok('section breakdown', res.sections?.[0]?.net === 19 && Number(res.sections[0].points) === 99.75, JSON.stringify(res.sections?.[0]))
  const after = await student.rpc('attempt_answer', { p_attempt_id: attemptId, p_seq: 1, p_choice: 'A' })
  ok('a submitted attempt takes no more answers', (after.data ?? 0) === 0 && !after.error)

  // ── the list reflects it ───────────────────────────────────────────────
  const list = await student.rpc('student_exams')
  const rowA = list.data?.find((r) => r.id === examA)
  ok('list shows completed with score', rowA?.status === 'completed' && rowA?.correct === 20 && Number(rowA?.score) === 99.75 && rowA?.attempt_count === 1, JSON.stringify(rowA))

  // ── retake, and the timeout path ───────────────────────────────────────
  const re = await student.rpc('attempt_start', { p_exam_id: examA })
  ok('retake is attempt 2', !re.error && (re.data as any).attempt.attempt_no === 2, re.error?.message)
  const id2 = (re.data as any).attempt.id as number
  await student.rpc('attempt_answer', { p_attempt_id: id2, p_seq: 1, p_choice: answerOf(1) })
  // Burn the clock: pretend the beats added up to the limit.
  await admin.from('exam_attempts').update({ time_used_seconds: 1799, last_seen_at: new Date(Date.now() - 10_000).toISOString() }).eq('id', id2)
  const beat = await student.rpc('attempt_heartbeat', { p_attempt_id: id2 })
  ok('clock running out submits by timeout', beat.data === 0)
  const { data: row2 } = await admin.from('exam_attempts').select('status, submitted_by, correct_count').eq('id', id2).single()
  ok('timeout scored what was answered', row2?.status === 'submitted' && row2?.submitted_by === 'timeout' && row2?.correct_count === 1, JSON.stringify(row2))
  const list2 = await student.rpc('student_exams')
  const rowA2 = list2.data?.find((r) => r.id === examA)
  ok('list: latest attempt shown, best kept', rowA2?.correct === 1 && Number(rowA2?.best_score) === 99.75 && rowA2?.attempt_count === 2, JSON.stringify({ c: rowA2?.correct, best: rowA2?.best_score, n: rowA2?.attempt_count }))
  const b = await student.rpc('attempt_start', { p_exam_id: examB })
  ok('another exam can start once the first is handed in', !b.error, b.error?.message)
} finally {
  for (const id of examIds) await admin.from('exams').delete().eq('id', id)
  if (uid) await admin.auth.admin.deleteUser(uid)
  console.log(`cleaned up ${examIds.length} exam(s) and the probe student`)
}
if (failed) process.exit(1)

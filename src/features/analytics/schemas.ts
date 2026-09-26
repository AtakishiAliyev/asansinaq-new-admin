import { z } from 'zod'

// What the analytics functions return, parsed at the boundary. Every
// percentage is already 0–100 from the server; `null` means "no data yet"
// (no sittings, no timed responses), never zero.

const pct = z.coerce.number().nullable()
const num = z.coerce.number()

export const overviewSchema = z.object({
  students_total: num,
  students_active_7d: num,
  attempts_total: num,
  attempts_7d: num,
  responses_total: num,
  accuracy_pct: pct,
  blank_pct: pct,
  avg_score_pct: pct,
  weak_topics: z.array(
    z.object({
      category_id: num,
      name: z.string(),
      subject_name: z.string(),
      responses: num,
      miss_pct: num,
    }),
  ),
  suspicious_questions: num,
  open_reports: num,
})
export type Overview = z.infer<typeof overviewSchema>

export const questionStatsRowSchema = z.object({
  question_id: num,
  responses: num,
  correct_pct: num,
  blank_pct: num,
  wrong_pct: num,
  avg_time: pct,
  suspicious: z.boolean(),
  open_reports: num,
})
export type QuestionStatsRow = z.infer<typeof questionStatsRowSchema>

export const reportSchema = z.object({
  id: num,
  note: z.string(),
  status: z.enum(['open', 'resolved', 'dismissed']),
  created_at: z.string(),
  attempt_id: num.nullable(),
  seq: num.nullable(),
  student_name: z.string().nullable(),
})
export type Report = z.infer<typeof reportSchema>

export const questionAnalyticsSchema = z.object({
  question_id: num,
  responses: num,
  students: num,
  correct_pct: pct,
  blank_pct: pct,
  wrong_pct: pct,
  avg_time: pct,
  median_time: pct,
  board_pct: pct,
  avg_changes: pct,
  answer: z.string().nullable(),
  choices: z.record(z.string(), num),
  discrimination: pct,
  suspicious: z.boolean(),
  by_context_kind: z.array(
    z.object({
      context_kind: z.string(),
      responses: num,
      correct_pct: num,
      blank_pct: num,
      avg_time: pct,
    }),
  ),
  by_context: z.array(
    z.object({
      context_kind: z.string(),
      context_id: num,
      title: z.string().nullable(),
      responses: num,
      correct_pct: num,
      blank_pct: num,
      avg_time: pct,
    }),
  ),
  reports: z.array(reportSchema),
})
export type QuestionAnalytics = z.infer<typeof questionAnalyticsSchema>

export const denemeRowSchema = z.object({
  exam_id: num,
  title: z.string(),
  seq: num,
  kind: z.string().nullable(),
  question_count: num,
  attempts: num,
  students: num,
  avg_score: pct,
  median_score: pct,
  max_score: num,
  avg_pct: pct,
  avg_time_seconds: pct,
  timeout_pct: pct,
  retake_pct: pct,
  blank_pct: pct,
  last_attempt_at: z.string().nullable(),
})
export type DenemeRow = z.infer<typeof denemeRowSchema>

export const denemeItemSchema = z.object({
  seq: num,
  question_id: num.nullable(),
  category_id: num.nullable(),
  category_name: z.string().nullable(),
  difficulty: num.nullable(),
  answer: z.string(),
  responses: num,
  correct_pct: num,
  blank_pct: num,
  wrong_pct: num,
  avg_time: pct,
  board_pct: num,
  avg_changes: num,
  choices: z.record(z.string(), num),
  discrimination: pct,
  suspicious: z.boolean(),
  open_reports: num,
})
export type DenemeItem = z.infer<typeof denemeItemSchema>

export const denemeAnalyticsSchema = z.object({
  exam_id: num,
  attempts: num,
  students: num,
  avg_score: pct,
  median_score: pct,
  max_score: pct,
  avg_pct: pct,
  avg_time_seconds: pct,
  timeout_pct: pct,
  retake_pct: pct,
  reviewed_pct: pct,
  histogram: z.array(z.object({ bin: num, n: num })),
  sections: z.array(
    z.object({
      position: num,
      subject_name: z.string(),
      avg_net: pct,
      avg_points: pct,
      max_points: pct,
      avg_correct: pct,
      avg_wrong: pct,
      avg_blank: pct,
    }),
  ),
  by_day: z.array(z.object({ day: z.string(), n: num, avg_pct: pct })),
  items: z.array(denemeItemSchema),
})
export type DenemeAnalytics = z.infer<typeof denemeAnalyticsSchema>

export const topicRowSchema = z.object({
  category_id: num,
  category_name: z.string(),
  subject_id: num,
  subject_name: z.string(),
  questions: num,
  responses: num,
  correct_pct: num,
  blank_pct: num,
  wrong_pct: num,
  avg_time: pct,
  avg_difficulty: pct,
})
export type TopicRow = z.infer<typeof topicRowSchema>

export const attemptRowSchema = z.object({
  attempt_id: num,
  user_id: z.string(),
  student_name: z.string().nullable(),
  exam_id: num,
  exam_title: z.string(),
  attempt_no: num,
  score: pct,
  max_score: pct,
  correct_count: num.nullable(),
  wrong_count: num.nullable(),
  blank_count: num.nullable(),
  time_used_seconds: num,
  submitted_by: z.string().nullable(),
  submitted_at: z.string().nullable(),
  reviewed: z.boolean(),
  total: num,
})
export type AttemptRow = z.infer<typeof attemptRowSchema>

export const studentAnalyticsSchema = z.object({
  profile: z
    .object({
      id: z.string(),
      full_name: z.string(),
      goal_score: num.nullable(),
      grade: z.string().nullable(),
      level: z.string().nullable(),
      placement_at: z.string().nullable(),
      created_at: z.string(),
    })
    .nullable(),
  attempts: z.array(
    z.object({
      id: num,
      exam_id: num,
      title: z.string(),
      attempt_no: num,
      score: pct,
      max_score: pct,
      correct_count: num.nullable(),
      wrong_count: num.nullable(),
      blank_count: num.nullable(),
      time_used_seconds: num,
      submitted_by: z.string().nullable(),
      submitted_at: z.string().nullable(),
      reviewed: z.boolean(),
    }),
  ),
  responses: num,
  accuracy_pct: pct,
  blank_pct: pct,
  wrong_pct: pct,
  avg_time: pct,
  topics: z.array(
    z.object({
      category_id: num,
      name: z.string(),
      subject_name: z.string(),
      responses: num,
      correct_pct: num,
      blank_pct: num,
    }),
  ),
})
export type StudentAnalytics = z.infer<typeof studentAnalyticsSchema>

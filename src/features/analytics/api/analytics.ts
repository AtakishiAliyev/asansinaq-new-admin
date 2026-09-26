import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import { analyticsKeys } from '@/features/analytics/api/keys'
import {
  attemptRowSchema,
  denemeAnalyticsSchema,
  denemeRowSchema,
  overviewSchema,
  questionAnalyticsSchema,
  questionStatsRowSchema,
  studentAnalyticsSchema,
  topicRowSchema,
  roadmapAnalyticsSchema,
  roadmapRowSchema,
} from '@/features/analytics/schemas'

// Every read is one `analytics_*` function on the server, admin-only by its
// own guard; the client parses the shape and nothing else. Numbers are
// computed on request, so a minute of staleness is fine and a refetch on
// every focus is not.
const STALE = 60_000

export function useAnalyticsOverview() {
  return useQuery({
    queryKey: analyticsKeys.overview(),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('analytics_overview')
      if (error) throw error
      return overviewSchema.parse(data)
    },
    staleTime: STALE,
  })
}

export const ATTEMPTS_PAGE_SIZE = 50

/** Per-question figures for the ids on screen; a Map so a row looks itself up. */
export function useQuestionStats(ids: number[]) {
  const sorted = [...ids].sort((a, b) => a - b)
  return useQuery({
    queryKey: analyticsKeys.questionStats(sorted),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('analytics_question_stats', {
        p_question_ids: sorted,
      })
      if (error) throw error
      const rows = z.array(questionStatsRowSchema).parse(data)
      return new Map(rows.map((r) => [r.question_id, r]))
    },
    enabled: sorted.length > 0,
    staleTime: STALE,
  })
}

export function useQuestionAnalytics(questionId: number | null) {
  return useQuery({
    queryKey: analyticsKeys.question(questionId ?? 0),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('analytics_question', {
        p_question_id: questionId!,
      })
      if (error) throw error
      return questionAnalyticsSchema.parse(data)
    },
    enabled: questionId !== null,
    staleTime: STALE,
  })
}

export function useDenemeler() {
  return useQuery({
    queryKey: analyticsKeys.denemeler(),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('analytics_denemeler')
      if (error) throw error
      return z.array(denemeRowSchema).parse(data)
    },
    staleTime: STALE,
  })
}

// The roads as contexts, the way the denemeler are: one row each, and one
// road in depth with its funnel.
export function useRoadmapRows() {
  return useQuery({
    queryKey: analyticsKeys.roadmaps(),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('analytics_roadmaps')
      if (error) throw error
      return z.array(roadmapRowSchema).parse(data)
    },
    staleTime: STALE,
  })
}

export function useRoadmapAnalytics(roadmapId: number) {
  return useQuery({
    queryKey: analyticsKeys.roadmap(roadmapId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('analytics_roadmap', {
        p_roadmap_id: roadmapId,
      })
      if (error) throw error
      return roadmapAnalyticsSchema.parse(data)
    },
    enabled: roadmapId > 0,
    staleTime: STALE,
  })
}

export function useDenemeAnalytics(examId: number) {
  return useQuery({
    queryKey: analyticsKeys.deneme(examId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('analytics_deneme', {
        p_exam_id: examId,
      })
      if (error) throw error
      return denemeAnalyticsSchema.parse(data)
    },
    enabled: examId > 0,
    staleTime: STALE,
  })
}

export function useTopicAnalytics(subjectId: number | null) {
  return useQuery({
    queryKey: analyticsKeys.topics(subjectId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('analytics_topics', {
        p_subject_id: subjectId ?? undefined,
      })
      if (error) throw error
      return z.array(topicRowSchema).parse(data)
    },
    staleTime: STALE,
  })
}

export function useAttemptRows(examId: number | null, page: number) {
  return useQuery({
    queryKey: analyticsKeys.attempts(examId, page),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('analytics_attempts', {
        p_exam_id: examId ?? undefined,
        p_limit: ATTEMPTS_PAGE_SIZE,
        p_offset: page * ATTEMPTS_PAGE_SIZE,
      })
      if (error) throw error
      const rows = z.array(attemptRowSchema).parse(data)
      return { rows, total: rows[0]?.total ?? 0 }
    },
    staleTime: STALE,
  })
}

export function useStudentAnalytics(userId: string | null) {
  return useQuery({
    queryKey: analyticsKeys.student(userId ?? ''),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('analytics_student', {
        p_user_id: userId!,
      })
      if (error) throw error
      return studentAnalyticsSchema.parse(data)
    },
    enabled: userId !== null,
    staleTime: STALE,
  })
}

/** Closes a student's report; the row stays, as the record of what was said. */
export function useResolveReport(questionId: number) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: number
      status: 'resolved' | 'dismissed'
    }) => {
      const { data: auth } = await supabase.auth.getUser()
      const { error } = await supabase
        .from('question_reports')
        .update({
          status,
          resolved_at: new Date().toISOString(),
          resolved_by: auth.user?.id ?? null,
        })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: analyticsKeys.question(questionId),
      })
      void client.invalidateQueries({ queryKey: analyticsKeys.overview() })
    },
  })
}

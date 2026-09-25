import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import { examKeys } from '@/features/exams/api/keys'
import { authored } from '@/features/exams/api/authored'
import {
  examDetailSchema,
  examListItemSchema,
  versionSchema,
  type ExamDetail,
  type ExamListItem,
} from '@/features/exams/schemas'

// `exams` and `exam_versions` are joined by TWO foreign keys — a version's
// exam, and an exam's current version — so the embed names the one it means.
const CURRENT =
  'current:exam_versions!exams_current_version_fkey(version_no, published_at)'

const LIST_SELECT = `id, program_id, template_id, seq, title, is_visible, current_version_id, draft_updated_at, updated_at, template:exam_templates(name, sections:exam_template_sections(question_count)), ${CURRENT}, items:exam_items(count)`

async function fetchExams(programId: number): Promise<ExamListItem[]> {
  const { data, error } = await supabase
    .from('exams')
    .select(LIST_SELECT)
    .eq('program_id', programId)
    .order('seq', { ascending: false })
  if (error) throw error
  return z.array(examListItemSchema).parse(data)
}

export function useExams(programId: number | null) {
  return useQuery({
    queryKey: examKeys.list(programId ?? 0),
    queryFn: () => fetchExams(programId!),
    enabled: programId !== null,
  })
}

const DETAIL_SELECT = `id, program_id, template_id, seq, title, is_visible, current_version_id, draft_updated_at, updated_at, template:exam_templates(id, program_id, name, name_pattern, duration_seconds, navigation, pause_on_exit, allow_retake, reveal_answers, scoring_method, base_score, min_score, sort_order, archived_at, sections:exam_template_sections(position, subject_id, question_count, duration_seconds, points_correct, penalty_ratio)), ${CURRENT}`

async function fetchExam(id: number): Promise<ExamDetail | null> {
  const { data, error } = await supabase
    .from('exams')
    .select(DETAIL_SELECT)
    .eq('id', id)
    .order('position', { referencedTable: 'template.sections' })
    .maybeSingle()
  if (error) throw error
  // Null, not an error: a deleted exam is a page that does not exist, and
  // retrying a query for it only keeps a spinner on screen.
  return data ? examDetailSchema.parse(data) : null
}

export function useExam(id: number) {
  return useQuery({
    queryKey: examKeys.detail(id),
    queryFn: () => fetchExam(id),
    enabled: id > 0,
  })
}

async function fetchVersions(examId: number) {
  const { data, error } = await supabase
    .from('exam_versions')
    .select(
      'id, version_no, published_at, question_count, max_score, duration_seconds',
    )
    .eq('exam_id', examId)
    .order('version_no', { ascending: false })
  if (error) throw error
  return z.array(versionSchema).parse(data)
}

export function useVersions(examId: number) {
  return useQuery({
    queryKey: examKeys.versions(examId),
    queryFn: () => fetchVersions(examId),
  })
}

export function useCreateExam() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (templateId: number) => {
      const { data, error } = await supabase.rpc('exam_create', {
        p_template_id: templateId,
      })
      if (error) throw authored(error)
      return z.object({ id: z.number().int() }).parse(data)
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: examKeys.lists() }),
  })
}

export function useUpdateExam(id: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (patch: { title?: string; is_visible?: boolean }) => {
      const { error } = await supabase.from('exams').update(patch).eq('id', id)
      if (error) throw authored(error)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: examKeys.detail(id) })
      void queryClient.invalidateQueries({ queryKey: examKeys.lists() })
    },
  })
}

export function useDeleteExam() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      const { error } = await supabase.from('exams').delete().eq('id', id)
      if (error) throw authored(error)
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: examKeys.lists() }),
  })
}

export type ExamState = 'draft' | 'published' | 'changed'

/**
 * Where an exam stands. "changed" is a published exam whose draft has moved
 * on since — what students see is still the last version.
 */
export function examState(
  exam: Pick<ExamListItem, 'current' | 'draft_updated_at'>,
): ExamState {
  if (!exam.current) return 'draft'
  return new Date(exam.draft_updated_at) > new Date(exam.current.published_at)
    ? 'changed'
    : 'published'
}

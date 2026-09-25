import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import { examKeys } from '@/features/exams/api/keys'
import { authored } from '@/features/exams/api/authored'
import {
  templateSchema,
  type Template,
  type TemplateFormValues,
} from '@/features/exams/schemas'

const TEMPLATE_SELECT =
  'id, program_id, name, name_pattern, duration_seconds, navigation, pause_on_exit, allow_retake, reveal_answers, scoring_method, base_score, min_score, sort_order, archived_at, sections:exam_template_sections(position, subject_id, question_count, duration_seconds, points_correct, penalty_ratio)'

export async function fetchTemplates(programId: number): Promise<Template[]> {
  const { data, error } = await supabase
    .from('exam_templates')
    .select(TEMPLATE_SELECT)
    .eq('program_id', programId)
    .order('sort_order')
    .order('position', { referencedTable: 'sections' })
  if (error) throw error
  return z.array(templateSchema).parse(data)
}

export function useTemplates(programId: number | null) {
  return useQuery({
    queryKey: examKeys.templates(programId ?? 0),
    queryFn: () => fetchTemplates(programId!),
    enabled: programId !== null,
  })
}

/** The highest score a template can award: base plus every question right. */
export function maxScoreOf(
  template: Pick<Template, 'base_score' | 'sections'>,
) {
  return (
    template.base_score +
    template.sections.reduce(
      (s, x) => s + x.question_count * x.points_correct,
      0,
    )
  )
}

export function useSaveTemplate(programId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      values,
    }: {
      id: number | null
      values: TemplateFormValues
    }) => {
      const { error } = await supabase.rpc('exam_template_save', {
        // The generated signature says `number`; a new template is created
        // by passing null, which the function takes as "insert".
        p_id: id as number,
        p_template: {
          program_id: programId,
          name: values.name,
          name_pattern: values.name_pattern,
          duration_seconds: values.duration_minutes * 60,
          navigation: values.navigation,
          pause_on_exit: values.pause_on_exit,
          allow_retake: values.allow_retake,
          reveal_answers: values.reveal_answers,
          base_score: values.base_score,
          min_score: values.min_score,
        },
        p_sections: values.sections.map((s) => ({
          subject_id: s.subject_id,
          question_count: s.question_count,
          duration_seconds: s.duration_minutes ? s.duration_minutes * 60 : null,
          points_correct: s.points_correct,
          penalty_ratio: s.penalty_ratio,
        })),
      })
      if (error) throw authored(error)
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: examKeys.templates(programId),
      }),
  })
}

export function useArchiveTemplate(programId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, archived }: { id: number; archived: boolean }) => {
      const { error } = await supabase
        .from('exam_templates')
        .update({ archived_at: archived ? new Date().toISOString() : null })
        .eq('id', id)
      if (error) throw authored(error)
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: examKeys.templates(programId),
      }),
  })
}

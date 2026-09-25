import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import { examKeys } from '@/features/exams/api/keys'
import { authored } from '@/features/exams/api/authored'
import {
  draftRowSchema,
  pickRowSchema,
  type BuilderQuestion,
} from '@/features/exams/schemas'
import { fromDraftRow } from '@/features/exams/lib/question'

/** The draft, one ordered list per section position. */
export type DraftSections = Map<number, BuilderQuestion[]>

async function fetchDraft(examId: number): Promise<DraftSections> {
  const { data, error } = await supabase.rpc('exam_draft_items', {
    p_exam_id: examId,
  })
  if (error) throw error
  const sections: DraftSections = new Map()
  for (const row of z.array(draftRowSchema).parse(data)) {
    const list = sections.get(row.section_position) ?? []
    list.push(fromDraftRow(row))
    sections.set(row.section_position, list)
  }
  return sections
}

export function useDraft(examId: number) {
  return useQuery({
    queryKey: examKeys.draft(examId),
    queryFn: () => fetchDraft(examId),
    // The builder holds the working copy; a background refetch replacing it
    // mid-drag would undo what the admin is doing.
    refetchOnWindowFocus: false,
  })
}

export function useSaveSection(examId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      section,
      ids,
    }: {
      section: number
      ids: number[]
    }) => {
      const { error } = await supabase.rpc('exam_set_items', {
        p_exam_id: examId,
        p_section_position: section,
        p_question_ids: ids,
      })
      if (error) throw authored(error)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: examKeys.detail(examId) })
      void queryClient.invalidateQueries({ queryKey: examKeys.lists() })
    },
  })
}

// A type alias, not an interface, so it is assignable to the generated
// `Json` parameter type without a cast.
export type RecipeCell = {
  category_id: number
  difficulty: number | null
  count: number
}

/** Draws questions at random for a recipe; returns them with the full data a
 *  slot needs, in the order they were drawn. */
export async function pickQuestions(
  examId: number,
  cells: RecipeCell[],
  unusedOnly: boolean,
): Promise<BuilderQuestion[]> {
  const { data, error } = await supabase.rpc('exam_autofill_pick', {
    p_exam_id: examId,
    p_cells: cells,
    p_unused_only: unusedOnly,
  })
  if (error) throw authored(error)
  const ids = z
    .array(pickRowSchema)
    .parse(data)
    .map((r) => r.question_id)
  if (!ids.length) return []

  const { data: rows, error: qError } = await supabase
    .from('questions')
    .select('id, category_id, difficulty, stem, options, answer, figures')
    .in('id', ids)
  if (qError) throw qError
  const byId = new Map(
    z
      .array(
        z.object({
          id: z.number().int(),
          category_id: z.number().int().nullable(),
          difficulty: z.number().int().nullable(),
          stem: z.string().nullable(),
          options: z.unknown(),
          answer: z.string().nullable(),
          figures: z.unknown(),
        }),
      )
      .parse(rows)
      .map((r) => [
        r.id,
        fromDraftRow({
          section_position: 0,
          item_position: 0,
          question_id: r.id,
          category_id: r.category_id,
          difficulty: r.difficulty,
          status: 'approved',
          stem: r.stem,
          options: r.options,
          answer: r.answer,
          figures: r.figures,
          // Not known here. The builder saves the section and re-reads the
          // draft straight after, which brings the real count.
          usage_count: 0,
          changed_since_publish: false,
        }),
      ]),
  )
  return ids.flatMap((id) => {
    const q = byId.get(id)
    return q ? [q] : []
  })
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import { parseFigures, parseOptions } from '@/features/questions'
import { authored } from '@/features/exams/api/authored'
import type { BuilderQuestion } from '@/features/exams/schemas'
import { buildPublishAssets } from '@/features/exams/lib/publish-assets'
import { roadmapKeys } from '@/features/roadmaps/api/keys'
import {
  roadmapDetailSchema,
  roadmapListRowSchema,
  type NodeKind,
  type RoadmapDetail,
  type RoadmapListRow,
} from '@/features/roadmaps/schemas'

// The draft is read straight from its tables (admin RLS); every change goes
// through a `roadmap_*` function, so positions stay gapless and the draft's
// clock moves. Publishing is the deneme's two steps: the browser renders
// figure plates, then one call takes the snapshot.

const LIST_SELECT =
  'id, program_id, title, description, status, current_version_id, sort_order, draft_updated_at, updated_at, stages:roadmap_stages(count), enrolled:user_roadmaps(count), current:roadmap_versions!roadmaps_current_version_fkey(version_no, published_at, node_count)'

export function useRoadmaps(programId: number | null) {
  return useQuery({
    queryKey: roadmapKeys.list(programId ?? 0),
    queryFn: async (): Promise<RoadmapListRow[]> => {
      const { data, error } = await supabase
        .from('roadmaps')
        .select(LIST_SELECT)
        .eq('program_id', programId!)
        .order('sort_order')
        .order('id')
      if (error) throw error
      return z.array(roadmapListRowSchema).parse(data)
    },
    enabled: programId !== null,
  })
}

const DETAIL_SELECT =
  'id, program_id, title, description, status, current_version_id, draft_updated_at, stages:roadmap_stages(id, position, title, nodes:roadmap_nodes(id, stage_id, position, title, kind, exam_id, items:roadmap_node_items(count))), current:roadmap_versions!roadmaps_current_version_fkey(version_no, published_at)'

export function useRoadmap(id: number) {
  return useQuery({
    queryKey: roadmapKeys.detail(id),
    queryFn: async (): Promise<RoadmapDetail> => {
      const { data, error } = await supabase
        .from('roadmaps')
        .select(DETAIL_SELECT)
        .eq('id', id)
        .single()
      if (error) throw error
      const d = roadmapDetailSchema.parse(data)
      d.stages.sort((a, b) => a.position - b.position)
      for (const s of d.stages) s.nodes.sort((a, b) => a.position - b.position)
      return d
    },
    enabled: id > 0,
    refetchOnWindowFocus: false,
  })
}

const questionRowSchema = z.object({
  id: z.number().int(),
  category_id: z.number().int().nullable(),
  difficulty: z.number().int().nullable(),
  stem: z.string().nullable(),
  options: z.unknown(),
  answer: z.string().nullable(),
  figures: z.unknown(),
  status: z.string(),
})

function toBuilder(row: z.infer<typeof questionRowSchema>): BuilderQuestion {
  return {
    id: row.id,
    categoryId: row.category_id,
    difficulty: row.difficulty,
    stem: row.stem ?? '',
    options: parseOptions(row.options),
    answer: row.answer,
    figures: parseFigures(row.figures),
    usageCount: 0,
    status: row.status,
  }
}

async function fetchQuestions(
  ids: number[],
): Promise<Map<number, BuilderQuestion>> {
  if (!ids.length) return new Map()
  const { data, error } = await supabase
    .from('questions')
    .select(
      'id, category_id, difficulty, stem, options, answer, figures, status',
    )
    .in('id', ids)
  if (error) throw error
  return new Map(
    z
      .array(questionRowSchema)
      .parse(data)
      .map((r) => [r.id, toBuilder(r)]),
  )
}

/** A node's questions, in the admin's order, with what a slot shows. */
export function useNodeItems(nodeId: number | null) {
  return useQuery({
    queryKey: roadmapKeys.nodeItems(nodeId ?? 0),
    queryFn: async (): Promise<BuilderQuestion[]> => {
      const { data, error } = await supabase
        .from('roadmap_node_items')
        .select('position, question_id')
        .eq('node_id', nodeId!)
        .order('position')
      if (error) throw error
      const rows = z
        .array(
          z.object({
            position: z.number().int(),
            question_id: z.number().int(),
          }),
        )
        .parse(data)
      const byId = await fetchQuestions(rows.map((r) => r.question_id))
      return rows
        .map((r) => byId.get(r.question_id))
        .filter((q): q is BuilderQuestion => q !== undefined)
    },
    enabled: nodeId !== null,
    refetchOnWindowFocus: false,
  })
}

function useInvalidate(id: number) {
  const client = useQueryClient()
  return () => {
    void client.invalidateQueries({ queryKey: roadmapKeys.detail(id) })
    void client.invalidateQueries({ queryKey: roadmapKeys.problems(id) })
    void client.invalidateQueries({ queryKey: roadmapKeys.lists() })
  }
}

export function useCreateRoadmap() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({
      programId,
      title,
    }: {
      programId: number
      title: string
    }) => {
      const { data, error } = await supabase.rpc('roadmap_create', {
        p_program_id: programId,
        p_title: title,
      })
      if (error) throw authored(error)
      return z.object({ id: z.number().int() }).parse(data)
    },
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: roadmapKeys.lists() }),
  })
}

export function useUpdateRoadmap(id: number) {
  const invalidate = useInvalidate(id)
  return useMutation({
    mutationFn: async (patch: { title?: string; description?: string }) => {
      const { error } = await supabase
        .from('roadmaps')
        .update({ ...patch, draft_updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw authored(error)
    },
    onSuccess: invalidate,
  })
}

export function useAddStage(id: number) {
  const invalidate = useInvalidate(id)
  return useMutation({
    mutationFn: async (title: string) => {
      const { error } = await supabase.rpc('roadmap_stage_add', {
        p_roadmap_id: id,
        p_title: title,
      })
      if (error) throw authored(error)
    },
    onSuccess: invalidate,
  })
}

export function useRenameStage(id: number) {
  const invalidate = useInvalidate(id)
  return useMutation({
    mutationFn: async ({
      stageId,
      title,
    }: {
      stageId: number
      title: string
    }) => {
      const { error } = await supabase
        .from('roadmap_stages')
        .update({ title })
        .eq('id', stageId)
      if (error) throw authored(error)
    },
    onSuccess: invalidate,
  })
}

export function useReorderStages(id: number) {
  const invalidate = useInvalidate(id)
  return useMutation({
    mutationFn: async (stageIds: number[]) => {
      const { error } = await supabase.rpc('roadmap_stage_reorder', {
        p_roadmap_id: id,
        p_stage_ids: stageIds,
      })
      if (error) throw authored(error)
    },
    onSuccess: invalidate,
  })
}

export function useDeleteStage(id: number) {
  const invalidate = useInvalidate(id)
  return useMutation({
    mutationFn: async (stageId: number) => {
      const { error } = await supabase.rpc('roadmap_stage_delete', {
        p_stage_id: stageId,
      })
      if (error) throw authored(error)
    },
    onSuccess: invalidate,
  })
}

export function useAddNode(id: number) {
  const invalidate = useInvalidate(id)
  return useMutation({
    mutationFn: async ({
      stageId,
      title,
      kind,
    }: {
      stageId: number
      title: string
      kind: NodeKind
    }) => {
      const { data, error } = await supabase.rpc('roadmap_node_add', {
        p_stage_id: stageId,
        p_title: title,
        p_kind: kind,
      })
      if (error) throw authored(error)
      return z.object({ id: z.number().int() }).parse(data)
    },
    onSuccess: invalidate,
  })
}

export function useUpdateNode(id: number) {
  const invalidate = useInvalidate(id)
  return useMutation({
    mutationFn: async ({
      nodeId,
      ...patch
    }: {
      nodeId: number
      title?: string
      kind?: NodeKind
    }) => {
      const { error } = await supabase
        .from('roadmap_nodes')
        .update(patch)
        .eq('id', nodeId)
      if (error) throw authored(error)
    },
    onSuccess: invalidate,
  })
}

export function useMoveNode(id: number) {
  const invalidate = useInvalidate(id)
  return useMutation({
    mutationFn: async ({
      nodeId,
      stageId,
      position,
    }: {
      nodeId: number
      stageId: number
      position: number
    }) => {
      const { error } = await supabase.rpc('roadmap_node_move', {
        p_node_id: nodeId,
        p_stage_id: stageId,
        p_position: position,
      })
      if (error) throw authored(error)
    },
    onSuccess: invalidate,
  })
}

export function useDeleteNode(id: number) {
  const invalidate = useInvalidate(id)
  return useMutation({
    mutationFn: async (nodeId: number) => {
      const { error } = await supabase.rpc('roadmap_node_delete', {
        p_node_id: nodeId,
      })
      if (error) throw authored(error)
    },
    onSuccess: invalidate,
  })
}

export function useSetNodeItems(id: number) {
  const client = useQueryClient()
  const invalidate = useInvalidate(id)
  return useMutation({
    mutationFn: async ({
      nodeId,
      questions,
    }: {
      nodeId: number
      questions: BuilderQuestion[]
    }) => {
      const { error } = await supabase.rpc('roadmap_node_set_items', {
        p_node_id: nodeId,
        p_question_ids: questions.map((q) => q.id),
      })
      if (error) throw authored(error)
    },
    onMutate: ({ nodeId, questions }) => {
      client.setQueryData(roadmapKeys.nodeItems(nodeId), questions)
    },
    onSuccess: invalidate,
  })
}

export function usePublishProblems(id: number) {
  return useQuery({
    queryKey: roadmapKeys.problems(id),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('roadmap_publish_problems', {
        p_roadmap_id: id,
      })
      if (error) throw error
      return z.array(z.string()).parse(data)
    },
    enabled: id > 0,
  })
}

export function usePublishRoadmap(id: number) {
  const invalidate = useInvalidate(id)
  return useMutation({
    mutationFn: async (onProgress?: (done: number, total: number) => void) => {
      const { data: rows, error } = await supabase.rpc(
        'roadmap_draft_questions',
        { p_roadmap_id: id },
      )
      if (error) throw authored(error)
      const ids = [
        ...new Set(
          z
            .array(z.object({ question_id: z.number().int() }))
            .parse(rows)
            .map((r) => r.question_id),
        ),
      ]
      const byId = await fetchQuestions(ids)
      const assets = await buildPublishAssets(
        `r${id}`,
        [...byId.values()],
        onProgress,
      )
      const { data, error: pubError } = await supabase.rpc('roadmap_publish', {
        p_roadmap_id: id,
        p_assets: assets,
      })
      if (pubError) throw authored(pubError)
      return z
        .object({ id: z.number().int(), version_no: z.number().int() })
        .parse(data)
    },
    onSuccess: invalidate,
  })
}

export function useArchiveRoadmap(id: number) {
  const invalidate = useInvalidate(id)
  return useMutation({
    mutationFn: async (archived: boolean) => {
      const { error } = await supabase.rpc('roadmap_archive', {
        p_roadmap_id: id,
        p_archived: archived,
      })
      if (error) throw authored(error)
    },
    onSuccess: invalidate,
  })
}

export function useDeleteRoadmap() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      const { error } = await supabase.from('roadmaps').delete().eq('id', id)
      if (error) throw authored(error)
    },
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: roadmapKeys.lists() }),
  })
}

import { z } from 'zod'

export const roadmapStatusSchema = z.enum(['draft', 'published', 'archived'])
export type RoadmapStatus = z.infer<typeof roadmapStatusSchema>

const count = z.array(z.object({ count: z.number().int() }))

export const roadmapListRowSchema = z.object({
  id: z.number().int(),
  program_id: z.number().int(),
  title: z.string(),
  description: z.string(),
  status: roadmapStatusSchema,
  current_version_id: z.number().int().nullable(),
  sort_order: z.number().int(),
  draft_updated_at: z.string(),
  updated_at: z.string(),
  stages: count,
  enrolled: count,
  current: z
    .object({
      version_no: z.number().int(),
      published_at: z.string(),
      node_count: z.number().int(),
    })
    .nullable(),
})
export type RoadmapListRow = z.infer<typeof roadmapListRowSchema>

export const roadmapNodeRowSchema = z.object({
  id: z.number().int(),
  stage_id: z.number().int(),
  position: z.number().int(),
  title: z.string(),
  kind: z.enum(['topic_test', 'mixed_test', 'checkpoint']),
  exam_id: z.number().int().nullable(),
  items: count,
})
export type RoadmapNodeRow = z.infer<typeof roadmapNodeRowSchema>

export const roadmapStageRowSchema = z.object({
  id: z.number().int(),
  position: z.number().int(),
  title: z.string(),
  nodes: z.array(roadmapNodeRowSchema),
})
export type RoadmapStageRow = z.infer<typeof roadmapStageRowSchema>

export const roadmapDetailSchema = z.object({
  id: z.number().int(),
  program_id: z.number().int(),
  title: z.string(),
  description: z.string(),
  status: roadmapStatusSchema,
  current_version_id: z.number().int().nullable(),
  draft_updated_at: z.string(),
  stages: z.array(roadmapStageRowSchema),
  current: z
    .object({ version_no: z.number().int(), published_at: z.string() })
    .nullable(),
})
export type RoadmapDetail = z.infer<typeof roadmapDetailSchema>

export const NODE_KINDS = [
  { key: 'topic_test', label: 'Mövzu testi' },
  { key: 'mixed_test', label: 'Qarışıq test' },
  { key: 'checkpoint', label: 'Yoxlama' },
] as const
export type NodeKind = (typeof NODE_KINDS)[number]['key']
export const NODE_KIND_LABEL: Record<NodeKind, string> = Object.fromEntries(
  NODE_KINDS.map((k) => [k.key, k.label]),
) as Record<NodeKind, string>

export const STATUS_LABEL: Record<RoadmapStatus, string> = {
  draft: 'Qaralama',
  published: 'Dərc olunub',
  archived: 'Arxiv',
}

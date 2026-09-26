export const roadmapKeys = {
  all: ['roadmaps'] as const,
  lists: () => [...roadmapKeys.all, 'list'] as const,
  list: (programId: number) => [...roadmapKeys.lists(), programId] as const,
  detail: (id: number) => [...roadmapKeys.all, 'detail', id] as const,
  nodeItems: (nodeId: number) =>
    [...roadmapKeys.all, 'node-items', nodeId] as const,
  problems: (id: number) => [...roadmapKeys.all, 'problems', id] as const,
}

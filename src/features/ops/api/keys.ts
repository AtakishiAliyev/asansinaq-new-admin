export const opsKeys = {
  all: ['ops'] as const,
  budget: () => [...opsKeys.all, 'budget'] as const,
  summary: () => [...opsKeys.all, 'summary'] as const,
  daily: (days: number) => [...opsKeys.all, 'daily', days] as const,
  recent: (limit: number) => [...opsKeys.all, 'recent', limit] as const,
}

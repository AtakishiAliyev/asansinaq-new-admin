export const dashboardKeys = {
  all: ['dashboard'] as const,
  bankByTopic: () => [...dashboardKeys.all, 'bank-by-topic'] as const,
  subjects: () => [...dashboardKeys.all, 'subjects'] as const,
}

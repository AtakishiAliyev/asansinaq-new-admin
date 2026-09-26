export const analyticsKeys = {
  all: ['analytics'] as const,
  overview: () => [...analyticsKeys.all, 'overview'] as const,
  questionStats: (ids: number[]) =>
    [...analyticsKeys.all, 'question-stats', ids] as const,
  question: (id: number) => [...analyticsKeys.all, 'question', id] as const,
  denemeler: () => [...analyticsKeys.all, 'denemeler'] as const,
  deneme: (examId: number) => [...analyticsKeys.all, 'deneme', examId] as const,
  topics: (subjectId: number | null) =>
    [...analyticsKeys.all, 'topics', subjectId] as const,
  attempts: (examId: number | null, page: number) =>
    [...analyticsKeys.all, 'attempts', examId, page] as const,
  student: (userId: string) =>
    [...analyticsKeys.all, 'student', userId] as const,
}

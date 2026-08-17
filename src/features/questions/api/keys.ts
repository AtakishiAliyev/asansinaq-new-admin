import type { QuestionFilters } from '@/features/questions/api/questions'

export const questionKeys = {
  all: ['questions'] as const,
  lists: () => [...questionKeys.all, 'list'] as const,
  list: (filters: QuestionFilters, page: number) =>
    [...questionKeys.lists(), filters, page] as const,
  counts: (bookId: number | 'all') =>
    [...questionKeys.all, 'counts', bookId] as const,
  spend: () => [...questionKeys.all, 'spend'] as const,
  signed: (key: string) => [...questionKeys.all, 'signed', key] as const,
}

import type { SearchFilters } from '@/features/exams/schemas'

type FacetFilters = Omit<SearchFilters, 'categoryIds' | 'difficulties'>

export const examKeys = {
  all: ['exams'] as const,
  templates: (programId: number) =>
    [...examKeys.all, 'templates', programId] as const,
  lists: () => [...examKeys.all, 'list'] as const,
  list: (programId: number) => [...examKeys.lists(), programId] as const,
  detail: (id: number) => [...examKeys.all, 'detail', id] as const,
  draft: (id: number) => [...examKeys.all, 'draft', id] as const,
  versions: (id: number) => [...examKeys.all, 'versions', id] as const,
  searches: () => [...examKeys.all, 'search'] as const,
  search: (filters: SearchFilters) =>
    [...examKeys.searches(), filters] as const,
  facets: (filters: FacetFilters) =>
    [...examKeys.all, 'facets', filters] as const,
  signed: (paths: string) => [...examKeys.all, 'signed', paths] as const,
  categories: (subjectId: number) =>
    [...examKeys.all, 'categories', subjectId] as const,
  bankCount: (subjectId: number) =>
    [...examKeys.all, 'bank-count', subjectId] as const,
}

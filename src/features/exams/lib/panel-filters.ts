import type { FiguresFilter } from '@/features/exams/schemas'

export interface PanelFilters {
  categoryIds: number[]
  difficulties: number[]
  figures: FiguresFilter
  search: string
  unusedOnly: boolean
}

export const EMPTY_FILTERS: PanelFilters = {
  categoryIds: [],
  difficulties: [],
  figures: 'any',
  search: '',
  unusedOnly: false,
}

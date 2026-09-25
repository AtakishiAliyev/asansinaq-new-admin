import { useInfiniteQuery, useQueries, useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import { examKeys } from '@/features/exams/api/keys'
import {
  facetRowSchema,
  searchRowSchema,
  type BuilderQuestion,
  type SearchFilters,
} from '@/features/exams/schemas'
import { fromSearchRow } from '@/features/exams/lib/question'

export const SEARCH_PAGE = 50

// Keyset paging: each page asks for the rows after the last id it has. With
// OFFSET the database re-reads everything it skips, and a builder scrolling
// through a bank of hundreds of thousands would feel every page get slower.
export function useQuestionSearch(filters: SearchFilters | null) {
  return useInfiniteQuery({
    queryKey: examKeys.search(filters!),
    enabled: filters !== null,
    initialPageParam: null as number | null,
    queryFn: async ({ pageParam }): Promise<BuilderQuestion[]> => {
      const f = filters!
      const { data, error } = await supabase.rpc('exam_question_search', {
        p_subject_id: f.subjectId,
        // An empty selection means "every topic", not "no topic".
        p_category_ids: f.categoryIds.length ? f.categoryIds : undefined,
        p_difficulties: f.difficulties.length ? f.difficulties : undefined,
        p_figures: f.figures,
        p_search: f.search.trim() || undefined,
        p_unused_only: f.unusedOnly,
        p_exam_id: f.examId,
        p_after_id: pageParam ?? undefined,
        p_limit: SEARCH_PAGE,
      })
      if (error) throw error
      return z.array(searchRowSchema).parse(data).map(fromSearchRow)
    },
    getNextPageParam: (last) =>
      last.length === SEARCH_PAGE ? (last.at(-1)?.id ?? null) : null,
  })
}

/**
 * Counts per (topic, difficulty) under every filter but those two, so the
 * panel can say what each topic or difficulty would leave before it is
 * pressed.
 */
export function useFacets(filters: SearchFilters | null) {
  const facetFilters = filters && {
    subjectId: filters.subjectId,
    figures: filters.figures,
    search: filters.search.trim(),
    unusedOnly: filters.unusedOnly,
    examId: filters.examId,
  }
  return useQuery({
    queryKey: examKeys.facets(facetFilters!),
    enabled: facetFilters !== null,
    queryFn: async () => {
      const f = facetFilters!
      const { data, error } = await supabase.rpc('exam_question_facets', {
        p_subject_id: f.subjectId,
        p_figures: f.figures,
        p_search: f.search || undefined,
        p_unused_only: f.unusedOnly,
        p_exam_id: f.examId,
      })
      if (error) throw error
      return z.array(facetRowSchema).parse(data)
    },
    placeholderData: (previous) => previous,
  })
}

/**
 * How many usable questions — approved and answered — each subject has.
 * Asked before an exam is created, so a template whose subject the bank
 * cannot fill says so before a draft nobody can publish exists.
 */
export function useBankCounts(subjectIds: number[]) {
  const ids = [...new Set(subjectIds)]
  return useQueries({
    queries: ids.map((sid) => ({
      queryKey: examKeys.bankCount(sid),
      queryFn: async () => {
        const { data, error } = await supabase.rpc('exam_question_facets', {
          p_subject_id: sid,
        })
        if (error) throw error
        return z
          .array(facetRowSchema)
          .parse(data)
          .reduce((s, f) => s + f.n, 0)
      },
    })),
    combine: (results) => {
      const counts = new Map<number, number>()
      results.forEach((r, i) => {
        if (r.data !== undefined) counts.set(ids[i]!, r.data)
      })
      return counts
    },
  })
}

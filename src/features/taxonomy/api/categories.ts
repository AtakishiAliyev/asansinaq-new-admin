import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import { taxonomyKeys } from '@/features/taxonomy/api/keys'
import { categorySchema, type Category } from '@/features/taxonomy/schemas'
import { taxonomyErrorMessage } from '@/features/taxonomy/taxonomy-error-message'

async function fetchCategories(subjectId: number): Promise<Category[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('id, subject_id, parent_id, name, sort_order')
    .eq('subject_id', subjectId)
    .order('sort_order')
    .order('name')
  if (error) throw error
  return z.array(categorySchema).parse(data)
}

export function useCategories(subjectId: number | null) {
  return useQuery({
    queryKey: taxonomyKeys.categories(subjectId ?? -1),
    queryFn: () => fetchCategories(subjectId as number),
    enabled: subjectId !== null,
  })
}

function useCategoryMutation<TInput extends { subjectId: number }>(
  mutationFn: (input: TInput) => Promise<void>,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({
        queryKey: taxonomyKeys.categories(input.subjectId),
      })
      // Subject rows show category counts, so they refresh too. The program id
      // is unknown here; invalidating the subjects branch as a whole is cheap.
      void queryClient.invalidateQueries({
        queryKey: [...taxonomyKeys.all, 'subjects'],
      })
    },
    onError: (error) => toast.error(taxonomyErrorMessage(error)),
  })
}

export function useCreateCategory() {
  return useCategoryMutation(
    async (input: { subjectId: number; parentId: number | null; name: string }) => {
      const { error } = await supabase.from('categories').insert({
        subject_id: input.subjectId,
        parent_id: input.parentId,
        name: input.name,
      })
      if (error) throw error
    },
  )
}

export function useRenameCategory() {
  return useCategoryMutation(
    async ({ id, name }: { subjectId: number; id: number; name: string }) => {
      const { error } = await supabase
        .from('categories')
        .update({ name })
        .eq('id', id)
      if (error) throw error
    },
  )
}

export function useDeleteCategory() {
  return useCategoryMutation(
    async ({ id }: { subjectId: number; id: number }) => {
      const { error } = await supabase.from('categories').delete().eq('id', id)
      if (error) throw error
    },
  )
}

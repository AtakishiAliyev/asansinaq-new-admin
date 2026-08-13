import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import { taxonomyKeys } from '@/features/taxonomy/api/keys'
import { subjectSchema, type Subject } from '@/features/taxonomy/schemas'
import { taxonomyErrorMessage } from '@/features/taxonomy/taxonomy-error-message'

const subjectRowSchema = z.object({
  id: z.number(),
  program_id: z.number(),
  name: z.string(),
  sort_order: z.number(),
  categories: z.array(z.object({ count: z.number() })),
})

async function fetchSubjects(programId: number): Promise<Subject[]> {
  const { data, error } = await supabase
    .from('subjects')
    .select('id, program_id, name, sort_order, categories(count)')
    .eq('program_id', programId)
    .order('sort_order')
    .order('name')
  if (error) throw error
  return z
    .array(subjectRowSchema)
    .parse(data)
    .map((row) =>
      subjectSchema.parse({
        ...row,
        category_count: row.categories[0]?.count ?? 0,
      }),
    )
}

export function useSubjects(programId: number | null) {
  return useQuery({
    queryKey: taxonomyKeys.subjects(programId ?? -1),
    queryFn: () => fetchSubjects(programId as number),
    enabled: programId !== null,
  })
}

function useSubjectMutation<TInput extends { programId: number }>(
  mutationFn: (input: TInput) => Promise<void>,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: (_data, input) =>
      queryClient.invalidateQueries({
        queryKey: taxonomyKeys.subjects(input.programId),
      }),
    onError: (error) => toast.error(taxonomyErrorMessage(error)),
  })
}

export function useCreateSubject() {
  return useSubjectMutation(
    async ({ programId, name }: { programId: number; name: string }) => {
      const { error } = await supabase
        .from('subjects')
        .insert({ program_id: programId, name })
      if (error) throw error
    },
  )
}

export function useRenameSubject() {
  return useSubjectMutation(
    async ({ id, name }: { programId: number; id: number; name: string }) => {
      const { error } = await supabase
        .from('subjects')
        .update({ name })
        .eq('id', id)
      if (error) throw error
    },
  )
}

export function useDeleteSubject() {
  return useSubjectMutation(
    async ({ id }: { programId: number; id: number }) => {
      const { error } = await supabase.from('subjects').delete().eq('id', id)
      if (error) throw error
    },
  )
}

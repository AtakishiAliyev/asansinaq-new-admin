import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import { taxonomyKeys } from '@/features/taxonomy/api/keys'
import { programSchema, type Program } from '@/features/taxonomy/schemas'
import { taxonomyErrorMessage } from '@/features/taxonomy/taxonomy-error-message'

async function fetchPrograms(): Promise<Program[]> {
  const { data, error } = await supabase
    .from('programs')
    .select('id, name, sort_order')
    .order('sort_order')
    .order('name')
  if (error) throw error
  return z.array(programSchema).parse(data)
}

export function usePrograms() {
  return useQuery({
    queryKey: taxonomyKeys.programs(),
    queryFn: fetchPrograms,
  })
}

function useProgramMutation<TInput>(
  mutationFn: (input: TInput) => Promise<void>,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: taxonomyKeys.programs() }),
    onError: (error) => toast.error(taxonomyErrorMessage(error)),
  })
}

export function useCreateProgram() {
  return useProgramMutation(async (name: string) => {
    const { error } = await supabase.from('programs').insert({ name })
    if (error) throw error
  })
}

export function useRenameProgram() {
  return useProgramMutation(async ({ id, name }: { id: number; name: string }) => {
    const { error } = await supabase.from('programs').update({ name }).eq('id', id)
    if (error) throw error
  })
}

export function useDeleteProgram() {
  return useProgramMutation(async (id: number) => {
    const { error } = await supabase.from('programs').delete().eq('id', id)
    if (error) throw error
  })
}

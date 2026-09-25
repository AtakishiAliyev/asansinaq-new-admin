import { usePrograms } from '@/features/taxonomy'
import { useProgramStore } from '@/stores/program-store'

/**
 * The program the exam screens work in. The stored choice wins; before one
 * exists, or if the stored program has gone, the first program stands in.
 */
export function useActiveProgram() {
  const programs = usePrograms()
  const stored = useProgramStore((s) => s.programId)
  const list = programs.data ?? []
  const programId = list.some((p) => p.id === stored)
    ? stored
    : (list[0]?.id ?? null)
  const program = list.find((p) => p.id === programId) ?? null
  return { programs, programId, program }
}

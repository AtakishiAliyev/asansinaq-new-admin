import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useProgramStore } from '@/stores/program-store'
import { useActiveProgram } from '@/features/exams/hooks/use-active-program'

// Shown even while there is one program: it tells the operator where SAT or
// DİM will appear, and that every list under it belongs to the program named.
export function ProgramSelect() {
  const { programs, programId } = useActiveProgram()
  const setProgramId = useProgramStore((s) => s.setProgramId)
  return (
    <Select
      value={programId === null ? undefined : String(programId)}
      onValueChange={(v) => setProgramId(Number(v))}
      disabled={!programs.data?.length}
    >
      <SelectTrigger className="w-44" aria-label="Proqram">
        <SelectValue placeholder="Proqram" />
      </SelectTrigger>
      <SelectContent>
        {(programs.data ?? []).map((p) => (
          <SelectItem key={p.id} value={String(p.id)}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

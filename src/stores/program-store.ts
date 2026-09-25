import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Which program the exam screens are working in.
//
// The exam system is program-agnostic — YÖS today, SAT or DİM later — and
// every exam screen is scoped to one program at a time. The choice survives a
// reload because an operator building YÖS denemes all afternoon should not be
// asked again on every page. Null until the programs have loaded; the pages
// fall back to the first program then.
interface ProgramState {
  programId: number | null
  setProgramId: (programId: number) => void
}

export const useProgramStore = create<ProgramState>()(
  persist(
    (set) => ({
      programId: null,
      setProgramId: (programId) => set({ programId }),
    }),
    { name: 'asansinaq.exam-program' },
  ),
)

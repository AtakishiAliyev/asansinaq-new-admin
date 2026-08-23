import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Operator-set knobs for REVIEW, which is what is left in the browser.
//
// Batch size, image quality and the vector-first lane lived here when the tab
// was the worker. They are the worker's now — its own env, on its own machine —
// and two places to set one number is one place to set it wrong. Image quality
// has no meaning at all any more: no image is generated unattended.
//
// Every default reproduces the behaviour these settings replaced: turning
// nothing on changes nothing. Each knob trades cost or reviewer time against
// a risk, and the UI names that risk rather than only the saving.

export interface PipelineSettings {
  /**
   * Approve, without a reviewer, questions that pass every automatic check.
   * Reviewing 10k questions by hand is ~28 hours; this is the only lever
   * that removes work rather than moving it.
   */
  autoApprove: boolean
  /** Auto-approve only questions whose answer came from a printed key. */
  autoApproveNeedsAnswer: boolean
}

const DEFAULTS: PipelineSettings = {
  autoApprove: false,
  autoApproveNeedsAnswer: true,
}

interface PipelineStore extends PipelineSettings {
  set: (patch: Partial<PipelineSettings>) => void
  reset: () => void
}

export const usePipelineStore = create<PipelineStore>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      set: (patch) => set(patch),
      reset: () => set(DEFAULTS),
    }),
    { name: 'asansinaq-pipeline' },
  ),
)

export function pipelineSettings(): PipelineSettings {
  const { autoApprove, autoApproveNeedsAnswer } = usePipelineStore.getState()
  return { autoApprove, autoApproveNeedsAnswer }
}

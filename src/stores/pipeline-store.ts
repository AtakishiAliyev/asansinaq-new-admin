import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Operator-set knobs for the structuring pipeline. Persisted because they are
// decisions about a book-long job, not about one screen — and because the
// worker has to come back with them after a reload.
//
// Every default reproduces the behaviour these settings replaced: turning
// nothing on changes nothing. Each knob trades cost or reviewer time against
// a risk, and the UI names that risk rather than only the saving.

export interface PipelineSettings {
  /** Questions a worker takes per claim. Also the in-flight ceiling. */
  batchSize: number
  /**
   * Approve, without a reviewer, questions that pass every automatic check.
   * Reviewing 10k questions by hand is ~28 hours; this is the only lever
   * that removes work rather than moving it.
   */
  autoApprove: boolean
  /** Auto-approve only questions whose answer came from a printed key. */
  autoApproveNeedsAnswer: boolean
  /**
   * Generate figure images at medium quality. Roughly halves the image bill;
   * fine lines and small labels are where it shows first.
   */
  mediumImages: boolean
  /**
   * Try the vector DSL on coloured figures before paying for an image. The
   * DSL cannot express every colour treatment, so a failed attempt costs one
   * extra extract before the image runs anyway.
   */
  dslFirst: boolean
}

const DEFAULTS: PipelineSettings = {
  batchSize: 8,
  autoApprove: false,
  autoApproveNeedsAnswer: true,
  mediumImages: false,
  dslFirst: false,
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
  const { batchSize, autoApprove, autoApproveNeedsAnswer, mediumImages, dslFirst } =
    usePipelineStore.getState()
  return { batchSize, autoApprove, autoApproveNeedsAnswer, mediumImages, dslFirst }
}

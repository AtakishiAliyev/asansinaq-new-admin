import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { examKeys } from '@/features/exams/api/keys'
import { authored } from '@/features/exams/api/authored'
import { versionSchema, type BuilderQuestion } from '@/features/exams/schemas'
import { buildPublishAssets } from '@/features/exams/lib/publish-assets'

export interface PublishInput {
  questions: BuilderQuestion[]
  /** Show the exam to students once it is out. */
  makeVisible: boolean
  onProgress?: (done: number, total: number) => void
}

// Two steps, and only the second is a transaction. First the browser makes
// what only it can — figure plates as SVG, images copied to the public
// bucket. Then one database call checks the draft and writes the version,
// reading every word and every answer from the bank itself.
//
// A failure between the two leaves some copied images that no version points
// at. They are harmless — unreadable except by url, and the url was never
// handed out — and the next publish copies afresh.
export function usePublishExam(examId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      questions,
      makeVisible,
      onProgress,
    }: PublishInput) => {
      const assets = await buildPublishAssets(examId, questions, onProgress)
      const { data, error } = await supabase.rpc('exam_publish', {
        p_exam_id: examId,
        p_assets: assets,
      })
      if (error) throw authored(error)
      const version = versionSchema.parse(data)
      if (makeVisible) {
        const { error: visError } = await supabase
          .from('exams')
          .update({ is_visible: true })
          .eq('id', examId)
        if (visError) throw authored(visError)
      }
      return version
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: examKeys.detail(examId) })
      void queryClient.invalidateQueries({
        queryKey: examKeys.versions(examId),
      })
      void queryClient.invalidateQueries({ queryKey: examKeys.draft(examId) })
      void queryClient.invalidateQueries({ queryKey: examKeys.lists() })
    },
  })
}

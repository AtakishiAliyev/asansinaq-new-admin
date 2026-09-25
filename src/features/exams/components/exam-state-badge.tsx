import { Badge } from '@/components/ui/badge'
import type { ExamState } from '@/features/exams/api/exams'

export function ExamStateBadge({
  state,
  versionNo,
}: {
  state: ExamState
  versionNo: number | null
}) {
  if (state === 'draft') return <Badge variant="outline">Qaralama</Badge>
  if (state === 'changed') {
    return (
      <Badge
        variant="outline"
        className="border-amber-500/50 text-amber-700 dark:text-amber-400"
        title="Dərc olunmuş versiyadan sonra dəyişiklik edilib. Tələbələr hələ köhnə versiyanı görür."
      >
        v{versionNo} · dəyişiklik var
      </Badge>
    )
  }
  return <Badge>Dərc olunub · v{versionNo}</Badge>
}

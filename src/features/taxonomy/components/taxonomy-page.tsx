import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { usePrograms } from '@/features/taxonomy/api/programs'
import { useSubjects } from '@/features/taxonomy/api/subjects'
import { CategoryTree } from '@/features/taxonomy/components/category-tree'
import { ProgramMenu } from '@/features/taxonomy/components/program-menu'
import { SubjectList } from '@/features/taxonomy/components/subject-list'
import { usePageTitle } from '@/hooks/use-page-title'
import { QueryErrorAlert } from '@/components/query-error-alert'

export function TaxonomyPage() {
  usePageTitle('Fənn və kateqoriyalar')
  const programs = usePrograms()
  const [programId, setProgramId] = useState<number | null>(null)
  const [subjectId, setSubjectId] = useState<number | null>(null)

  const programList = programs.data
  const activeProgramExists =
    programList?.some((p) => p.id === programId) ?? false
  const firstProgramId = programList?.[0]?.id ?? null

  // Keep a valid program selected as the list changes — initial load, and the
  // case where the active program is deleted. Depends on primitives so it
  // settles in one pass.
  useEffect(() => {
    if (programList === undefined) return
    if (!activeProgramExists) {
      setProgramId(firstProgramId)
      setSubjectId(null)
    }
  }, [programList, activeProgramExists, firstProgramId])

  const subjects = useSubjects(programId)
  const subjectList = subjects.data
  const firstSubjectId = subjectList?.[0]?.id ?? null
  const selectedExists = subjectList?.some((s) => s.id === subjectId) ?? false
  const activeSubject = subjectList?.find((s) => s.id === subjectId)

  // Same idea for the selected subject (program switch, delete).
  useEffect(() => {
    if (subjectList === undefined) return
    if (!selectedExists) setSubjectId(firstSubjectId)
  }, [subjectList, selectedExists, firstSubjectId])

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          Fənn və kateqoriyalar
        </h1>
        {programList ? (
          <ProgramMenu
            programs={programList}
            activeProgramId={programId}
            onSelect={(id) => {
              setProgramId(id)
              setSubjectId(null)
            }}
          />
        ) : null}
      </div>

      {programs.isError ? (
        <QueryErrorAlert
          error={programs.error}
          onRetry={() => programs.refetch()}
          isRetrying={programs.isFetching}
        />
      ) : null}

      <Card>
        <CardContent className="p-0">
          <div className="grid md:grid-cols-[240px_minmax(0,1fr)]">
            <div className="border-b p-3 md:border-r md:border-b-0">
              {programs.isPending ||
              (subjects.isPending && programId !== null) ? (
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                </div>
              ) : subjects.isError ? (
                <QueryErrorAlert
                  error={subjects.error}
                  onRetry={() => subjects.refetch()}
                  isRetrying={subjects.isFetching}
                />
              ) : programId !== null ? (
                <SubjectList
                  key={programId}
                  programId={programId}
                  subjects={subjectList ?? []}
                  activeSubjectId={subjectId}
                  onSelect={setSubjectId}
                />
              ) : null}
            </div>

            <div className="p-4">
              <div className="mx-auto max-w-3xl">
                {subjectId !== null && activeSubject ? (
                  <CategoryTree
                    key={subjectId}
                    subjectId={subjectId}
                    subjectName={activeSubject.name}
                  />
                ) : (
                  <Empty>
                    <EmptyTitle>Fənn seçin</EmptyTitle>
                    <EmptyDescription>
                      Kateqoriyaları görmək üçün soldan bir fənn seçin və ya
                      əlavə edin.
                    </EmptyDescription>
                  </Empty>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

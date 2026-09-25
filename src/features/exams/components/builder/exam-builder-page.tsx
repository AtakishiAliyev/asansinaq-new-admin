import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router'
import { useQueries } from '@tanstack/react-query'
import { toast } from 'sonner'
import { QueryErrorAlert } from '@/components/query-error-alert'
import { Spinner } from '@/components/ui/spinner'
import { normalizeError } from '@/lib/errors'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { usePageTitle } from '@/hooks/use-page-title'
import { NotFoundPage } from '@/app/not-found-page'
import {
  fetchCategories,
  useSubjects,
  type Category,
} from '@/features/taxonomy'
import { examKeys } from '@/features/exams/api/keys'
import { useExam } from '@/features/exams/api/exams'
import { pickQuestions } from '@/features/exams/api/draft'
import { useFacets } from '@/features/exams/api/search'
import type {
  BuilderQuestion,
  ExamDetail,
  SearchFilters,
} from '@/features/exams/schemas'
import { AutofillDialog } from '@/features/exams/components/builder/autofill-dialog'
import { BuilderHeader } from '@/features/exams/components/builder/builder-header'
import { FilterPanel } from '@/features/exams/components/builder/filter-panel'
import {
  EMPTY_FILTERS,
  type PanelFilters,
} from '@/features/exams/lib/panel-filters'
import {
  ExamPreviewDialog,
  QuestionDialog,
} from '@/features/exams/components/builder/preview-dialogs'
import { PublishDialog } from '@/features/exams/components/builder/publish-dialog'
import { ResultsList } from '@/features/exams/components/builder/results-list'
import { SectionBlock } from '@/features/exams/components/builder/section-block'
import { useBuilder } from '@/features/exams/components/builder/use-builder'

export function ExamBuilderPage() {
  const { examId } = useParams()
  const id = Number(examId)
  const exam = useExam(Number.isInteger(id) && id > 0 ? id : 0)
  usePageTitle(exam.data?.title)

  if (!Number.isInteger(id) || id <= 0) return <NotFoundPage />
  if (exam.isPending) {
    return (
      <div className="flex justify-center py-24">
        <Spinner />
      </div>
    )
  }
  if (exam.isError) {
    return (
      <QueryErrorAlert
        error={exam.error}
        onRetry={() => void exam.refetch()}
        isRetrying={exam.isFetching}
      />
    )
  }
  if (!exam.data) return <NotFoundPage />
  return <Builder exam={exam.data} />
}

/** Every topic of every subject the exam's sections use — slots of a
 *  three-section exam come from three subjects. */
function useExamCategories(subjectIds: number[]) {
  return useQueries({
    queries: subjectIds.map((sid) => ({
      queryKey: examKeys.categories(sid),
      queryFn: () => fetchCategories(sid),
    })),
    combine: (results) => {
      const bySubject = new Map<number, Category[]>()
      results.forEach((r, i) => bySubject.set(subjectIds[i]!, r.data ?? []))
      return bySubject
    },
  })
}

// The builder: filters on the left, the bank in the middle, the exam on the
// right. The middle is always scoped to the section being filled — one
// subject at a time, because a section is one subject — and adding sends the
// question to that section.
function Builder({ exam }: { exam: ExamDetail }) {
  const template = exam.template
  const b = useBuilder(exam.id, template)
  const subjects = useSubjects(exam.program_id)
  const subjectIds = useMemo(
    () => template.sections.map((s) => s.subject_id),
    [template.sections],
  )
  const categoriesBySubject = useExamCategories(subjectIds)

  const section =
    template.sections.find((s) => s.position === b.active) ??
    template.sections[0]!
  const subjectId = section.subject_id
  const categories = useMemo(
    () =>
      [...(categoriesBySubject.get(subjectId) ?? [])].sort(
        (a, c) => a.sort_order - c.sort_order,
      ),
    [categoriesBySubject, subjectId],
  )

  const subjectName = useCallback(
    (sid: number) => subjects.data?.find((s) => s.id === sid)?.name ?? '—',
    [subjects.data],
  )
  const topicNames = useMemo(() => {
    const m = new Map<number, string>()
    for (const list of categoriesBySubject.values())
      for (const c of list) m.set(c.id, c.name)
    return m
  }, [categoriesBySubject])
  const topicName = useCallback(
    (cid: number | null) => (cid ? (topicNames.get(cid) ?? '—') : '—'),
    [topicNames],
  )

  // ── filters ──────────────────────────────────────────────────────────────
  const [panel, setPanel] = useState<PanelFilters>(EMPTY_FILTERS)
  const [panelSubject, setPanelSubject] = useState(subjectId)
  // Topics belong to a subject; switching section to another subject would
  // otherwise filter the new subject by topics it does not have.
  if (panelSubject !== subjectId) {
    setPanelSubject(subjectId)
    setPanel((p) => ({ ...p, categoryIds: [] }))
  }
  const search = useDebouncedValue(panel.search, 300)
  const filters: SearchFilters = useMemo(
    () => ({
      subjectId,
      categoryIds: panel.categoryIds,
      difficulties: panel.difficulties,
      figures: panel.figures,
      search,
      unusedOnly: panel.unusedOnly,
      examId: exam.id,
    }),
    [
      subjectId,
      panel.categoryIds,
      panel.difficulties,
      panel.figures,
      search,
      panel.unusedOnly,
      exam.id,
    ],
  )
  const facets = useFacets(filters)
  const total = useMemo(() => {
    if (!facets.data) return null
    return facets.data.reduce((sum, f) => {
      const topicOk =
        !filters.categoryIds.length ||
        (f.category_id !== null && filters.categoryIds.includes(f.category_id))
      const diffOk =
        !filters.difficulties.length ||
        (f.difficulty !== null && filters.difficulties.includes(f.difficulty))
      return topicOk && diffOk ? sum + f.n : sum
    }, 0)
  }, [facets.data, filters.categoryIds, filters.difficulties])

  // Nothing at all to pick from in this subject — known only when no
  // narrowing filter is set, since the facets are counted under those.
  const unfiltered =
    panel.figures === 'any' && !search.trim() && !panel.unusedOnly
  const subjectEmpty =
    unfiltered && facets.data && facets.data.reduce((s, f) => s + f.n, 0) === 0
      ? { subjectName: subjectName(subjectId) }
      : null

  // "/" jumps to the search box from anywhere that is not already typing.
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (
        e.key !== '/' ||
        t?.closest('input, textarea, [contenteditable="true"]')
      )
        return
      e.preventDefault()
      searchRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── actions ──────────────────────────────────────────────────────────────
  const activeList = b.sections.get(section.position) ?? []
  const capacity = section.question_count
  const canAdd = activeList.length < capacity

  const handleAdd = (q: BuilderQuestion): boolean => {
    const added = b.add(q)
    if (!added) return false
    // A section that has just filled hands over to the next one with room,
    // so a three-section exam can be filled in one pass down the list.
    if (activeList.length + 1 >= capacity) {
      const next = template.sections.find(
        (s) =>
          s.position !== section.position &&
          (b.sections.get(s.position)?.length ?? 0) < s.question_count,
      )
      if (next) {
        b.setActive(next.position)
        toast.success(
          `${subjectName(section.subject_id)} doldu. ${subjectName(next.subject_id)} bölməsinə keçildi.`,
        )
      } else {
        toast.success('Bütün bölmələr doldu. Dərc etməyə hazırdır.')
      }
    }
    return true
  }

  const [swappingId, setSwappingId] = useState<number | null>(null)
  const handleSwap = async (sectionPosition: number, q: BuilderQuestion) => {
    if (q.categoryId === null) {
      toast.info('Bu sualın mövzusu yoxdur, dəyişmək üçün əlavə olaraq seçin.')
      return
    }
    setSwappingId(q.id)
    try {
      const cells = [
        { category_id: q.categoryId, difficulty: q.difficulty, count: 1 },
      ]
      // An unused one first; failing that, any the exam does not already hold.
      let picked = await pickQuestions(exam.id, cells, true)
      if (!picked.length) picked = await pickQuestions(exam.id, cells, false)
      const replacement = picked[0]
      if (replacement) b.replace(sectionPosition, q.id, replacement)
      else toast.info('Bu mövzu və çətinlikdə başqa sual qalmayıb.')
    } catch (error) {
      toast.error(normalizeError(error).message)
    } finally {
      setSwappingId(null)
    }
  }

  const [previewing, setPreviewing] = useState<BuilderQuestion | null>(null)
  const [dialog, setDialog] = useState<
    'autofill' | 'publish' | 'preview' | null
  >(null)

  const examQuestions = useMemo(
    () => [...b.sections.values()].flat(),
    [b.sections],
  )

  let offset = 0

  return (
    <div className="-m-6 flex h-[calc(100dvh-3rem)] flex-col md:h-dvh">
      <BuilderHeader
        exam={exam}
        saveState={b.saveState}
        onAutofill={() => setDialog('autofill')}
        onPreview={() => setDialog('preview')}
        onPublish={() => setDialog('publish')}
      />

      {b.draft.isPending ? (
        <div className="flex flex-1 justify-center py-24">
          <Spinner />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[250px_minmax(0,1fr)_390px]">
          <aside className="min-h-0 border-b lg:overflow-y-auto lg:border-r lg:border-b-0">
            <FilterPanel
              filters={panel}
              onChange={setPanel}
              categories={categories}
              facets={facets.data ?? []}
              searchRef={searchRef}
            />
          </aside>

          <main className="h-[70vh] min-h-0 border-b lg:h-auto lg:border-b-0">
            <ResultsList
              filters={filters}
              total={total}
              subjectEmpty={subjectEmpty}
              idsInExam={b.idsInExam}
              canAdd={canAdd}
              topicName={topicName}
              onAdd={handleAdd}
            />
          </main>

          <aside className="flex min-h-0 flex-col gap-2.5 p-3 lg:overflow-y-auto lg:border-l">
            {template.sections.map((s) => {
              const qs = b.sections.get(s.position) ?? []
              const start = offset
              offset += s.question_count
              return (
                <SectionBlock
                  key={s.position}
                  position={s.position}
                  subjectName={subjectName(s.subject_id)}
                  questions={qs}
                  capacity={s.question_count}
                  isActive={s.position === section.position}
                  numberOffset={start}
                  topicName={topicName}
                  topicCount={
                    categoriesBySubject.get(s.subject_id)?.length ?? 0
                  }
                  swappingId={swappingId}
                  onActivate={() => b.setActive(s.position)}
                  onMove={(from, to) => b.move(s.position, from, to)}
                  onRemove={(qid) => b.remove(s.position, qid)}
                  onPreview={setPreviewing}
                  onSwap={(q) => void handleSwap(s.position, q)}
                />
              )
            })}
          </aside>
        </div>
      )}

      <AutofillDialog
        open={dialog === 'autofill'}
        onOpenChange={(v) => setDialog(v ? 'autofill' : null)}
        examId={exam.id}
        subjectId={subjectId}
        subjectName={subjectName(subjectId)}
        remaining={capacity - activeList.length}
        capacity={capacity}
        sectionQuestions={activeList}
        categories={categories}
        examQuestions={examQuestions}
        onFilled={(qs) => b.appendMany(section.position, qs)}
      />
      <PublishDialog
        open={dialog === 'publish'}
        onOpenChange={(v) => setDialog(v ? 'publish' : null)}
        exam={exam}
        sections={b.sections}
        subjectName={subjectName}
        settled={b.settled}
      />
      <ExamPreviewDialog
        open={dialog === 'preview'}
        onOpenChange={(v) => setDialog(v ? 'preview' : null)}
        title={exam.title}
        template={template}
        sections={b.sections}
        subjectName={subjectName}
      />
      <QuestionDialog
        question={previewing}
        topicName={topicName(previewing?.categoryId ?? null)}
        onOpenChange={(v) => !v && setPreviewing(null)}
      />
    </div>
  )
}

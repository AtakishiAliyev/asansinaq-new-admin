import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Plus, Settings2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { QueryErrorAlert } from '@/components/query-error-alert'
import { Spinner } from '@/components/ui/spinner'
import { normalizeError } from '@/lib/errors'
import { cn } from '@/lib/utils'
import {
  examState,
  useDeleteExam,
  useExams,
  useUpdateExam,
} from '@/features/exams/api/exams'
import type { ExamListItem } from '@/features/exams/schemas'
import { ExamStateBadge } from '@/features/exams/components/exam-state-badge'
import { NewExamDialog } from '@/features/exams/components/new-exam-dialog'
import { ProgramSelect } from '@/features/exams/components/program-select'
import { useActiveProgram } from '@/features/exams/hooks/use-active-program'
import { dateLabel } from '@/features/exams/lib/format'

const FILTERS = [
  { key: 'all', label: 'Hamısı' },
  { key: 'draft', label: 'Qaralama' },
  { key: 'published', label: 'Dərc olunub' },
  { key: 'hidden', label: 'Gizli' },
] as const
type Filter = (typeof FILTERS)[number]['key']

function matches(exam: ExamListItem, filter: Filter): boolean {
  if (filter === 'all') return true
  if (filter === 'draft') return !exam.current
  if (filter === 'published') return Boolean(exam.current) && exam.is_visible
  return Boolean(exam.current) && !exam.is_visible
}

// The denemes of one program: where each one stands and a way into it. The
// work happens in the builder; this is the shelf.
export function ExamsPage() {
  const { programId, program } = useActiveProgram()
  const exams = useExams(programId)
  const [filter, setFilter] = useState<Filter>('all')
  const [creating, setCreating] = useState(false)

  const rows = useMemo(
    () => (exams.data ?? []).filter((e) => matches(e, filter)),
    [exams.data, filter],
  )
  const counts = useMemo(() => {
    const all = exams.data ?? []
    return Object.fromEntries(
      FILTERS.map((f) => [f.key, all.filter((e) => matches(e, f.key)).length]),
    ) as Record<Filter, number>
  }, [exams.data])

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Denemələr</h1>
          <p className="text-muted-foreground text-sm">
            {program ? `${program.name} üzrə sınaqlar.` : 'Sınaqlar.'} Qaralama
            tələbələrə görünmür, dərc olunmuş versiya isə yalnız "Tələbələr"
            açıq olanda görünür.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ProgramSelect />
          <Button variant="outline" asChild>
            <Link to="/exams/templates">
              <Settings2 /> Şablonlar
            </Link>
          </Button>
          <Button
            onClick={() => setCreating(true)}
            disabled={programId === null}
          >
            <Plus /> Yeni deneme
          </Button>
        </div>
      </header>

      <div
        className="flex flex-wrap gap-1.5"
        role="radiogroup"
        aria-label="Vəziyyət"
      >
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="radio"
            aria-checked={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              'rounded-full border px-3 py-1 text-sm transition-colors',
              filter === f.key
                ? 'bg-primary text-primary-foreground border-transparent'
                : 'hover:bg-muted',
            )}
          >
            {f.label}
            <span className="ml-1.5 tabular-nums opacity-70">
              {counts[f.key] ?? 0}
            </span>
          </button>
        ))}
      </div>

      {exams.isError ? (
        <QueryErrorAlert
          error={exams.error}
          onRetry={() => void exams.refetch()}
          isRetrying={exams.isFetching}
        />
      ) : exams.isPending ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : rows.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>
              {(exams.data ?? []).length
                ? 'Bu filtrdə deneme yoxdur'
                : 'Hələ deneme yoxdur'}
            </EmptyTitle>
            <EmptyDescription>
              {(exams.data ?? []).length
                ? 'Başqa bir filtr seçin.'
                : 'İlk denemeni yaratmaq üçün "Yeni deneme" düyməsini basın.'}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ad</TableHead>
                <TableHead>Növ</TableHead>
                <TableHead>Suallar</TableHead>
                <TableHead>Vəziyyət</TableHead>
                <TableHead>Tələbələr</TableHead>
                <TableHead>Yenilənib</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((exam) => (
                <ExamRow key={exam.id} exam={exam} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {programId !== null ? (
        <NewExamDialog
          programId={programId}
          open={creating}
          onOpenChange={setCreating}
        />
      ) : null}
    </div>
  )
}

function ExamRow({ exam }: { exam: ExamListItem }) {
  const update = useUpdateExam(exam.id)
  const remove = useDeleteExam()
  const total = exam.template.sections.reduce((s, x) => s + x.question_count, 0)
  const filled = exam.items[0]?.count ?? 0
  const state = examState(exam)

  return (
    <TableRow>
      <TableCell className="font-medium">
        <Link to={`/exams/${exam.id}`} className="hover:underline">
          {exam.title}
        </Link>
      </TableCell>
      <TableCell className="text-muted-foreground">
        {exam.template.name}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <div
            className="bg-muted h-1.5 w-20 overflow-hidden rounded-full"
            aria-hidden
          >
            <div
              className={cn(
                'h-full rounded-full',
                filled >= total ? 'bg-emerald-600' : 'bg-primary',
              )}
              style={{
                width: `${total ? Math.min(100, (filled / total) * 100) : 0}%`,
              }}
            />
          </div>
          <span className="text-muted-foreground text-xs tabular-nums">
            {filled}/{total}
          </span>
        </div>
      </TableCell>
      <TableCell>
        <ExamStateBadge
          state={state}
          versionNo={exam.current?.version_no ?? null}
        />
      </TableCell>
      <TableCell>
        {/* A draft has nothing for students to see, so the switch waits for
            the first version. */}
        <Switch
          checked={exam.is_visible}
          disabled={!exam.current || update.isPending}
          onCheckedChange={(v) =>
            update.mutate(
              { is_visible: v },
              {
                onSuccess: () =>
                  toast.success(
                    v ? 'Tələbələrə göstərilir' : 'Tələbələrdən gizlədildi',
                  ),
                onError: (e) => toast.error(normalizeError(e).message),
              },
            )
          }
          aria-label={
            exam.is_visible ? 'Tələbələrdən gizlət' : 'Tələbələrə göstər'
          }
        />
      </TableCell>
      <TableCell className="text-muted-foreground text-xs">
        {dateLabel(exam.updated_at)}
      </TableCell>
      <TableCell>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Sil"
              disabled={remove.isPending}
            >
              <Trash2 />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{exam.title} silinsin?</AlertDialogTitle>
              <AlertDialogDescription>
                {exam.current
                  ? 'Bu deneme dərc olunub. Silinsə, bütün versiyaları da silinəcək. Tələbələrdən gizlətmək adətən daha doğrudur.'
                  : 'Qaralama və seçilmiş suallar silinəcək. Sualların özü bankda qalır.'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Ləğv et</AlertDialogCancel>
              <AlertDialogAction
                onClick={() =>
                  remove.mutate(exam.id, {
                    onSuccess: () => toast.success('Silindi'),
                    onError: (e) => toast.error(normalizeError(e).message),
                  })
                }
              >
                Sil
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </TableCell>
    </TableRow>
  )
}

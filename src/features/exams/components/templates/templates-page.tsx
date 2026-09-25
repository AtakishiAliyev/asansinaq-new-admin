import { useState } from 'react'
import { Link } from 'react-router'
import { Archive, ArchiveRestore, ArrowLeft, Pencil, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { QueryErrorAlert } from '@/components/query-error-alert'
import { normalizeError } from '@/lib/errors'
import { useSubjects } from '@/features/taxonomy'
import {
  maxScoreOf,
  useArchiveTemplate,
  useTemplates,
} from '@/features/exams/api/templates'
import type { Template } from '@/features/exams/schemas'
import { ProgramSelect } from '@/features/exams/components/program-select'
import { useActiveProgram } from '@/features/exams/hooks/use-active-program'
import { TemplateDialog } from '@/features/exams/components/templates/template-dialog'
import {
  minutesLabel,
  penaltyLabel,
  scoreLabel,
} from '@/features/exams/lib/format'

// The kinds of exam a program has, and their rules. This is the "settings"
// of the exam system: a new program — SAT, DİM — is a set of templates made
// here, not a change to the code.
export function TemplatesPage() {
  const { programId, program } = useActiveProgram()
  const templates = useTemplates(programId)
  const subjects = useSubjects(programId)
  const [editing, setEditing] = useState<Template | null | 'new'>(null)

  const subjectName = (id: number) =>
    subjects.data?.find((s) => s.id === id)?.name ?? '—'

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Link
            to="/exams"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
          >
            <ArrowLeft className="size-3.5" /> Denemələr
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">Şablonlar</h1>
          <p className="text-muted-foreground text-sm">
            {program
              ? `${program.name} üzrə deneme növləri.`
              : 'Deneme növləri.'}{' '}
            Hər dərc şablonun o anki qaydalarını öz versiyasına köçürür, ona
            görə dəyişiklik keçmiş nəticələrə toxunmur.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ProgramSelect />
          <Button
            onClick={() => setEditing('new')}
            disabled={programId === null || !subjects.data?.length}
          >
            <Plus /> Yeni şablon
          </Button>
        </div>
      </header>

      {templates.isError ? (
        <QueryErrorAlert
          error={templates.error}
          onRetry={() => void templates.refetch()}
          isRetrying={templates.isFetching}
        />
      ) : templates.isPending ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : (templates.data ?? []).length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed py-12 text-center text-sm">
          Bu proqramda şablon yoxdur.
        </p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {templates.data.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              programId={programId!}
              subjectName={subjectName}
              onEdit={() => setEditing(t)}
            />
          ))}
        </ul>
      )}

      {programId !== null ? (
        <TemplateDialog
          open={editing !== null}
          onOpenChange={(v) => !v && setEditing(null)}
          programId={programId}
          template={editing === 'new' ? null : editing}
          subjects={subjects.data ?? []}
        />
      ) : null}
    </div>
  )
}

function TemplateCard({
  template: t,
  programId,
  subjectName,
  onEdit,
}: {
  template: Template
  programId: number
  subjectName: (id: number) => string
  onEdit: () => void
}) {
  const archive = useArchiveTemplate(programId)
  const questions = t.sections.reduce((s, x) => s + x.question_count, 0)
  const rules = [
    t.navigation === 'free' ? 'sərbəst keçid' : 'ardıcıl keçid',
    t.pause_on_exit ? 'çıxanda vaxt dayanır' : 'vaxt dayanmır',
    t.allow_retake ? 'təkrar olar' : 'bir dəfə',
    t.reveal_answers === 'after_submit'
      ? 'cavablar sonda görünür'
      : 'cavablar görünmür',
  ]

  return (
    <li
      className={
        t.archived_at
          ? 'rounded-lg border p-4 opacity-60'
          : 'rounded-lg border p-4'
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="flex items-center gap-2 font-medium">
            {t.name}
            {t.archived_at ? <Badge variant="outline">arxiv</Badge> : null}
          </p>
          <p className="text-muted-foreground text-xs">
            {questions} sual · {minutesLabel(t.duration_seconds)} · maks.{' '}
            {scoreLabel(maxScoreOf(t))} bal
            {t.base_score > 0 ? ` (baza ${scoreLabel(t.base_score)})` : ''} ·
            ad: {t.name_pattern.replace('{nn}', '07')}
          </p>
        </div>
        <div className="flex shrink-0">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Redaktə et"
            onClick={onEdit}
          >
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t.archived_at ? 'Arxivdən çıxar' : 'Arxivlə'}
            title={
              t.archived_at
                ? 'Arxivdən çıxar'
                : 'Arxivlə — yeni deneme üçün təklif olunmayacaq'
            }
            disabled={archive.isPending}
            onClick={() =>
              archive.mutate(
                { id: t.id, archived: !t.archived_at },
                { onError: (e) => toast.error(normalizeError(e).message) },
              )
            }
          >
            {t.archived_at ? <ArchiveRestore /> : <Archive />}
          </Button>
        </div>
      </div>

      <table className="mt-3 w-full text-sm">
        <thead className="text-muted-foreground text-xs">
          <tr>
            <th className="py-1 text-left font-normal">Bölmə</th>
            <th className="py-1 text-right font-normal">Sual</th>
            <th className="py-1 text-right font-normal">Düzün balı</th>
            <th className="py-1 text-right font-normal">Cərimə</th>
          </tr>
        </thead>
        <tbody>
          {t.sections.map((s) => (
            <tr key={s.position} className="border-t">
              <td className="py-1.5">
                {s.position}. {subjectName(s.subject_id)}
                {s.duration_seconds ? (
                  <span className="text-muted-foreground text-xs">
                    {' '}
                    · {minutesLabel(s.duration_seconds)}
                  </span>
                ) : null}
              </td>
              <td className="py-1.5 text-right tabular-nums">
                {s.question_count}
              </td>
              <td className="py-1.5 text-right tabular-nums">
                {scoreLabel(s.points_correct)}
              </td>
              <td className="text-muted-foreground py-1.5 text-right text-xs">
                {penaltyLabel(s.penalty_ratio)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-muted-foreground mt-2 text-xs">{rules.join(' · ')}</p>
    </li>
  )
}

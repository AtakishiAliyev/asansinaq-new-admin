import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { MoreHorizontal, Plus, Route } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { QueryErrorAlert } from '@/components/query-error-alert'
import { usePageTitle } from '@/hooks/use-page-title'
import { normalizeError } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { ProgramSelect } from '@/features/exams/components/program-select'
import { useActiveProgram } from '@/features/exams/hooks/use-active-program'
import {
  useCreateRoadmap,
  useDeleteRoadmap,
  useRoadmaps,
} from '@/features/roadmaps/api/roadmaps'
import { STATUS_LABEL, type RoadmapListRow } from '@/features/roadmaps/schemas'

// The roadmaps of a program: what exists, what state it is in, how many
// students are on it. A roadmap is made here with a title and built on
// the next screen.
const STATUS_CLASS = {
  draft: 'text-muted-foreground',
  published: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  archived: 'border-zinc-200 bg-zinc-50 text-zinc-600',
} as const

export function RoadmapsPage() {
  usePageTitle('Yol xəritələri')
  const { programId, program } = useActiveProgram()
  const roadmaps = useRoadmaps(programId)
  const [creating, setCreating] = useState(false)

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Yol xəritələri
          </h1>
          <p className="text-muted-foreground text-sm">
            {program ? `${program.name} üzrə yollar.` : 'Yollar.'}{' '}
            Mərhələ-mərhələ addımlar, hər addımda bankdan yığılmış kiçik bir
            test. Qaralama tələbəyə görünmür; dərc olunan versiya başlayan
            tələbədə dəyişmir.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ProgramSelect />
          <Button
            onClick={() => setCreating(true)}
            disabled={programId === null}
          >
            <Plus /> Yeni yol
          </Button>
        </div>
      </header>

      {roadmaps.isError ? (
        <QueryErrorAlert
          error={roadmaps.error}
          onRetry={() => void roadmaps.refetch()}
          isRetrying={roadmaps.isFetching}
        />
      ) : roadmaps.isPending ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : roadmaps.data.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>Hələ yol xəritəsi yoxdur</EmptyTitle>
            <EmptyDescription>
              İlkini yaratmaq üçün "Yeni yol" düyməsini basın.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ad</TableHead>
                <TableHead>Vəziyyət</TableHead>
                <TableHead className="text-right">Mərhələ</TableHead>
                <TableHead className="text-right">Addım</TableHead>
                <TableHead className="text-right">Tələbə</TableHead>
                <TableHead>Yenilənib</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {roadmaps.data.map((r) => (
                <RoadmapRow key={r.id} roadmap={r} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {programId !== null ? (
        <NewRoadmapDialog
          programId={programId}
          open={creating}
          onOpenChange={setCreating}
        />
      ) : null}
    </div>
  )
}

function RoadmapRow({ roadmap: r }: { roadmap: RoadmapListRow }) {
  const remove = useDeleteRoadmap()
  const stale =
    r.current && new Date(r.draft_updated_at) > new Date(r.current.published_at)
  return (
    <TableRow>
      <TableCell className="font-medium">
        <Link
          to={`/roadmaps/${r.id}`}
          className="flex items-center gap-2 hover:underline"
        >
          <Route className="text-muted-foreground size-4" /> {r.title}
        </Link>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className={cn(STATUS_CLASS[r.status])}>
            {STATUS_LABEL[r.status]}
            {r.current ? ` · v${r.current.version_no}` : ''}
          </Badge>
          {stale ? (
            <Badge
              variant="outline"
              className="border-amber-200 bg-amber-50 text-amber-800"
            >
              dərc olunmamış dəyişiklik
            </Badge>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {r.stages[0]?.count ?? 0}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {r.current?.node_count ?? '—'}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {r.enrolled[0]?.count ?? 0}
      </TableCell>
      <TableCell className="text-muted-foreground text-xs tabular-nums">
        {new Date(r.updated_at).toLocaleDateString('az-AZ')}
      </TableCell>
      <TableCell>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Əməliyyatlar">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link to={`/roadmaps/${r.id}`}>Aç</Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              disabled={(r.enrolled[0]?.count ?? 0) > 0}
              onSelect={() => {
                if (!window.confirm(`"${r.title}" silinsin? Bu geri alınmır.`))
                  return
                remove.mutate(r.id, {
                  onError: (e) => toast.error(normalizeError(e).message),
                })
              }}
            >
              Sil
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  )
}

function NewRoadmapDialog({
  programId,
  open,
  onOpenChange,
}: {
  programId: number
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const create = useCreateRoadmap()
  const [title, setTitle] = useState('')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!title.trim()) return
            create.mutate(
              { programId, title: title.trim() },
              {
                onSuccess: ({ id }) => {
                  onOpenChange(false)
                  setTitle('')
                  void navigate(`/roadmaps/${id}`)
                },
                onError: (err) => toast.error(normalizeError(err).message),
              },
            )
          }}
          className="flex flex-col gap-4"
        >
          <DialogHeader>
            <DialogTitle>Yeni yol xəritəsi</DialogTitle>
            <DialogDescription>
              Adını verin; mərhələləri, addımları və sualları növbəti ekranda
              yığacaqsınız.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Məsələn: Cəbrə giriş"
            aria-label="Yol xəritəsinin adı"
            autoFocus
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Ləğv et
            </Button>
            <Button type="submit" disabled={!title.trim() || create.isPending}>
              Yarat
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

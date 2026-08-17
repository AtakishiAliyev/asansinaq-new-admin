import { useMemo, useState } from 'react'
import { z } from 'zod'
import { ArrowDown, ArrowUp, FolderOpen, Pencil, Trash2 } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { usePrograms } from '@/features/taxonomy'
import {
  useBooks,
  useDeleteBook,
  useUpdateBook,
} from '@/features/books/api/books'
import { BookDetailSheet } from '@/features/books/components/book-detail-sheet'
import { BookFormDialog } from '@/features/books/components/book-form-dialog'
import type { Book } from '@/features/books/schemas'
import { usePageTitle } from '@/hooks/use-page-title'
import { QueryErrorAlert } from '@/components/query-error-alert'
import { Spinner } from '@/components/ui/spinner'

function formatSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('az-Latn-AZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

const SORT_KEYS = ['title', 'pages', 'size', 'date', 'progress'] as const
type SortKey = (typeof SORT_KEYS)[number]

// Filters live in the URL so the work-queue view survives the round-trip to
// Import (browser back restores it exactly) and can be bookmarked. Invalid
// params degrade to the defaults instead of erroring.
const filterParamsSchema = z.object({
  q: z.string().catch(''),
  program: z.coerce.number().int().positive().optional().catch(undefined),
  subject: z.coerce.number().int().positive().optional().catch(undefined),
  tag: z.string().min(1).optional().catch(undefined),
  sort: z.enum(SORT_KEYS).catch('date'),
  desc: z.enum(['1', '0']).catch('1'),
})

const SORT_ACCESSORS: Record<SortKey, (b: Book) => string | number> = {
  title: (b) => b.title.toLocaleLowerCase('az'),
  pages: (b) => b.page_count ?? -1,
  size: (b) => b.file_size,
  date: (b) => b.created_at,
  progress: (b) => (b.page_count ? b.worked_pages.length / b.page_count : -1),
}

function SortHead({
  label,
  sortKey,
  sort,
  onSort,
  className,
}: {
  label: string
  sortKey: SortKey
  sort: { key: SortKey; desc: boolean }
  onSort: (key: SortKey) => void
  className?: string
}) {
  const active = sort.key === sortKey
  return (
    <TableHead
      className={className}
      aria-sort={active ? (sort.desc ? 'descending' : 'ascending') : undefined}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        aria-label={`${label} üzrə çeşidlə${active ? (sort.desc ? ' — azalan' : ' — artan') : ''}`}
        className={cn(
          'hover:text-foreground inline-flex items-center gap-1',
          active && 'text-foreground font-medium',
        )}
      >
        {label}
        {active ? (
          sort.desc ? (
            <ArrowDown className="size-3.5" />
          ) : (
            <ArrowUp className="size-3.5" />
          )
        ) : null}
      </button>
    </TableHead>
  )
}

export function BooksPage() {
  usePageTitle('Kitablar')
  const navigate = useNavigate()
  const books = useBooks()
  const programs = usePrograms()
  const updateBook = useUpdateBook()
  const deleteBook = useDeleteBook()

  const [searchParams, setSearchParams] = useSearchParams()
  const params = useMemo(
    () => filterParamsSchema.parse(Object.fromEntries(searchParams.entries())),
    [searchParams],
  )
  const search = params.q
  const programFilter: 'all' | number = params.program ?? 'all'
  const subjectFilter: 'all' | number = params.subject ?? 'all'
  const tagFilter: 'all' | string = params.tag ?? 'all'
  const sort = { key: params.sort, desc: params.desc === '1' }

  // replace, not push: keystrokes and filter tweaks must not spam history.
  function updateParams(patch: Record<string, string | null>) {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current)
        for (const [key, value] of Object.entries(patch)) {
          if (value === null || value === '') next.delete(key)
          else next.set(key, value)
        }
        return next
      },
      { replace: true },
    )
  }
  const [detail, setDetail] = useState<Book | null>(null)
  const [editing, setEditing] = useState<Book | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Book | null>(null)

  const allTags = useMemo(
    () => [...new Set((books.data ?? []).flatMap((b) => b.tags))].sort(),
    [books.data],
  )

  // Subjects actually present among the (program-filtered) books, so the
  // filter never offers an option that cannot match anything.
  const subjectOptions = useMemo(() => {
    const seen = new Map<number, string>()
    for (const b of books.data ?? []) {
      if (programFilter !== 'all' && b.program_id !== programFilter) continue
      if (b.subject_id !== null && b.subjects)
        seen.set(b.subject_id, b.subjects.name)
    }
    return [...seen.entries()].sort((a, z) => a[1].localeCompare(z[1]))
  }, [books.data, programFilter])

  const effectiveTagFilter =
    tagFilter !== 'all' && allTags.includes(tagFilter) ? tagFilter : 'all'
  const effectiveSubjectFilter =
    subjectFilter !== 'all' &&
    subjectOptions.some(([id]) => id === subjectFilter)
      ? subjectFilter
      : 'all'

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rows = (books.data ?? []).filter((book) => {
      if (programFilter !== 'all' && book.program_id !== programFilter)
        return false
      if (
        effectiveSubjectFilter !== 'all' &&
        book.subject_id !== effectiveSubjectFilter
      )
        return false
      if (
        effectiveTagFilter !== 'all' &&
        !book.tags.includes(effectiveTagFilter)
      )
        return false
      if (!q) return true
      return (
        book.title.toLowerCase().includes(q) ||
        book.original_name.toLowerCase().includes(q) ||
        (book.subjects?.name.toLowerCase().includes(q) ?? false)
      )
    })
    const accessor = SORT_ACCESSORS[sort.key]
    rows.sort((a, b) => {
      const va = accessor(a)
      const vb = accessor(b)
      const cmp =
        typeof va === 'string'
          ? va.localeCompare(vb as string)
          : va - (vb as number)
      return sort.desc ? -cmp : cmp
    })
    return rows
  }, [
    books.data,
    search,
    programFilter,
    effectiveSubjectFilter,
    effectiveTagFilter,
    sort.key,
    sort.desc,
  ])

  function toggleSort(key: SortKey) {
    const desc = sort.key === key ? !sort.desc : key === 'date'
    updateParams({ sort: key, desc: desc ? '1' : '0' })
  }

  function openInImport(book: Book) {
    navigate(`/import?book=${book.id}`)
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Kitablar</h1>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => updateParams({ q: e.target.value })}
          placeholder="Ad, fayl və ya fənn üzrə axtar…"
          className="max-w-72"
          aria-label="Kitab axtar"
        />
        <Select
          value={programFilter === 'all' ? 'all' : String(programFilter)}
          onValueChange={(v) =>
            updateParams({ program: v === 'all' ? null : v, subject: null })
          }
        >
          <SelectTrigger className="w-40" aria-label="Proqram süzgəci">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">Bütün proqramlar</SelectItem>
              {(programs.data ?? []).map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {subjectOptions.length > 0 ? (
          <Select
            value={
              effectiveSubjectFilter === 'all'
                ? 'all'
                : String(effectiveSubjectFilter)
            }
            onValueChange={(v) =>
              updateParams({ subject: v === 'all' ? null : v })
            }
          >
            <SelectTrigger className="w-40" aria-label="Fənn süzgəci">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">Bütün fənlər</SelectItem>
                {subjectOptions.map(([id, name]) => (
                  <SelectItem key={id} value={String(id)}>
                    {name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ) : null}
        {allTags.length > 0 ? (
          <Select
            value={
              effectiveTagFilter === 'all' ? 'all' : `tag:${effectiveTagFilter}`
            }
            onValueChange={(v) =>
              updateParams({ tag: v === 'all' ? null : v.slice(4) })
            }
          >
            <SelectTrigger className="w-40" aria-label="Tag süzgəci">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">Bütün taglar</SelectItem>
                {allTags.map((tag) => (
                  <SelectItem key={tag} value={`tag:${tag}`}>
                    {tag}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ) : null}
        <span className="text-muted-foreground ml-auto text-sm tabular-nums">
          {books.isSuccess
            ? `${filtered.length}${filtered.length !== books.data.length ? ` / ${books.data.length}` : ''} kitab`
            : '—'}
        </span>
      </div>

      {books.isPending ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : books.isError ? (
        <QueryErrorAlert
          error={books.error}
          onRetry={() => books.refetch()}
          isRetrying={books.isFetching}
        />
      ) : filtered.length === 0 ? (
        <Empty>
          <EmptyTitle>
            {books.data.length === 0 ? 'Hələ kitab yoxdur' : 'Nəticə tapılmadı'}
          </EmptyTitle>
          <EmptyDescription>
            {books.data.length === 0
              ? 'İmport səhifəsindən PDF yükləyin — kitab avtomatik bura düşəcək.'
              : 'Axtarışı və ya süzgəcləri dəyişin.'}
          </EmptyDescription>
        </Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <SortHead
                label="Ad"
                sortKey="title"
                sort={sort}
                onSort={toggleSort}
              />
              <TableHead>Fənn</TableHead>
              <TableHead>Taglar</TableHead>
              <SortHead
                label="Emal"
                sortKey="progress"
                sort={sort}
                onSort={toggleSort}
              />
              <SortHead
                label="Səhifə"
                sortKey="pages"
                sort={sort}
                onSort={toggleSort}
                className="text-right"
              />
              <SortHead
                label="Ölçü"
                sortKey="size"
                sort={sort}
                onSort={toggleSort}
                className="text-right"
              />
              <SortHead
                label="Tarix"
                sortKey="date"
                sort={sort}
                onSort={toggleSort}
              />
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((book) => {
              const worked = book.worked_pages.length
              const total = book.page_count ?? 0
              return (
                <TableRow
                  key={book.id}
                  className="group cursor-pointer"
                  onClick={() => setDetail(book)}
                >
                  <TableCell className="max-w-56">
                    {/* Real button: the row's onClick alone is unreachable
                        by keyboard and invisible to screen readers. */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setDetail(book)
                      }}
                      className="block w-full truncate text-left font-medium"
                    >
                      {book.title}
                    </button>
                    <span className="text-muted-foreground text-xs">
                      {book.programs?.name ?? '—'}
                      {book.storage_path === null
                        ? ' · arxiv faylı yoxdur'
                        : ''}
                    </span>
                  </TableCell>
                  <TableCell>{book.subjects?.name ?? '—'}</TableCell>
                  <TableCell className="max-w-36">
                    <span className="flex flex-wrap gap-1">
                      {book.tags.map((tag) => (
                        <Badge key={tag} variant="secondary">
                          {tag}
                        </Badge>
                      ))}
                    </span>
                  </TableCell>
                  <TableCell className="w-32">
                    {total > 0 ? (
                      <span className="flex items-center gap-2">
                        <Progress
                          value={(worked / total) * 100}
                          className="h-1.5 w-16"
                        />
                        <span className="text-muted-foreground text-xs tabular-nums">
                          {worked}/{total}
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {book.page_count ?? '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatSize(book.file_size)}
                  </TableCell>
                  <TableCell>{formatDate(book.created_at)}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <span className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`${book.title} import səhifəsində aç`}
                        disabled={book.storage_path === null}
                        onClick={() => openInImport(book)}
                      >
                        <FolderOpen />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`${book.title} redaktə et`}
                        onClick={() => setEditing(book)}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        aria-label={`${book.title} sil`}
                        onClick={() => setPendingDelete(book)}
                      >
                        <Trash2 />
                      </Button>
                    </span>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}

      <BookDetailSheet
        book={detail}
        onClose={() => setDetail(null)}
        onOpenInImport={openInImport}
        onEdit={(book) => {
          setDetail(null)
          setEditing(book)
        }}
        onDelete={(book) => {
          setDetail(null)
          setPendingDelete(book)
        }}
      />

      {editing ? (
        <BookFormDialog
          key={editing.id}
          open
          title="Kitabı redaktə et"
          submitLabel="Yadda saxla"
          isPending={updateBook.isPending}
          defaults={{
            title: editing.title,
            program_id: editing.program_id,
            subject_id: editing.subject_id,
            tags: editing.tags,
            note: editing.note ?? '',
          }}
          onCancel={() => setEditing(null)}
          onSubmit={(form) =>
            updateBook.mutate(
              { id: editing.id, form },
              { onSuccess: () => setEditing(null) },
            )
          }
        />
      ) : null}

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleteBook.isPending) setPendingDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              «{pendingDelete?.title}» silinsin?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Kitabın qeydi və arxiv faylı silinəcək. Bu əməliyyat geri
              qaytarıla bilməz.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBook.isPending}>
              İmtina
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteBook.isPending}
              onClick={(event) => {
                event.preventDefault()
                if (!pendingDelete) return
                deleteBook.mutate(pendingDelete, {
                  onSuccess: () => setPendingDelete(null),
                })
              }}
            >
              {deleteBook.isPending ? <Spinner data-icon="inline-start" /> : null}
              Sil
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

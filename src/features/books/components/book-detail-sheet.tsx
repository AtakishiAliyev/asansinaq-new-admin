import { Download, FolderOpen, Pencil, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Spinner } from '@/components/ui/spinner'
import { useSaveBookPdf } from '@/features/books/api/books'
import type { Book } from '@/features/books/schemas'

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

interface BookDetailSheetProps {
  book: Book | null
  onClose: () => void
  onOpenInImport: (book: Book) => void
  onEdit: (book: Book) => void
  onDelete: (book: Book) => void
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="min-w-0 text-right break-words">{value}</span>
    </div>
  )
}

export function BookDetailSheet({
  book,
  onClose,
  onOpenInImport,
  onEdit,
  onDelete,
}: BookDetailSheetProps) {
  const savePdf = useSaveBookPdf()
  if (!book) return null

  const worked = book.worked_pages.length
  const total = book.page_count ?? 0

  return (
    <Sheet open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <SheetContent className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="pr-8">{book.title}</SheetTitle>
          <SheetDescription className="flex flex-wrap gap-1.5">
            {book.programs ? (
              <Badge variant="outline">{book.programs.name}</Badge>
            ) : null}
            {book.subjects ? (
              <Badge variant="secondary">{book.subjects.name}</Badge>
            ) : null}
            {book.tags.map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
            {book.storage_path === null ? (
              <Badge variant="outline">arxiv faylı yoxdur</Badge>
            ) : null}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4">
          {total > 0 ? (
            <div className="flex flex-col gap-1.5">
              <div className="text-muted-foreground flex justify-between text-xs">
                <span>Emal</span>
                <span className="tabular-nums">
                  {worked}/{total} səhifə
                </span>
              </div>
              <Progress value={(worked / total) * 100} />
            </div>
          ) : null}

          {book.note ? (
            <p className="bg-muted/50 rounded-md border p-3 text-sm whitespace-pre-wrap">
              {book.note}
            </p>
          ) : null}

          <div className="flex flex-col gap-2">
            <Row label="Orijinal fayl" value={book.original_name} />
            <Row label="Ölçü" value={formatSize(book.file_size)} />
            <Row label="Səhifə sayı" value={book.page_count ?? '—'} />
            <Row label="Yüklənmə tarixi" value={formatDate(book.created_at)} />
            <Row
              label="Yükləyən"
              value={book.profiles?.full_name.trim() || '—'}
            />
            {book.content_hash ? (
              <Row
                label="Hash"
                value={
                  <span className="font-mono text-xs">
                    {book.content_hash.slice(0, 16)}…
                  </span>
                }
              />
            ) : null}
          </div>

          <Separator />

          <div className="flex flex-col gap-2">
            <Button
              disabled={book.storage_path === null}
              onClick={() => onOpenInImport(book)}
            >
              <FolderOpen data-icon="inline-start" />
              {worked > 0 ? 'İmportda davam et' : 'İmportda aç'}
            </Button>
            <div className="grid grid-cols-3 gap-2">
              <Button
                variant="outline"
                disabled={book.storage_path === null || savePdf.isPending}
                onClick={() => savePdf.mutate(book)}
              >
                {savePdf.isPending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <Download data-icon="inline-start" />
                )}
                Endir
              </Button>
              <Button variant="outline" onClick={() => onEdit(book)}>
                <Pencil data-icon="inline-start" />
                Redaktə et
              </Button>
              <Button
                variant="outline"
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => onDelete(book)}
              >
                <Trash2 data-icon="inline-start" />
                Sil
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

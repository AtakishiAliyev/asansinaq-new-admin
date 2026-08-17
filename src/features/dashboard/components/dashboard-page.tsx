import { ArrowRight, FileUp, Library, ListTree } from 'lucide-react'
import { Link } from 'react-router'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { useBooks, type Book } from '@/features/books'
import { usePageTitle } from '@/hooks/use-page-title'
import { normalizeError } from '@/lib/errors'

const QUICK_ACTIONS = [
  {
    to: '/import',
    label: 'PDF import et',
    description: 'Yeni kitab yüklə və ya arxivdən aç',
    icon: FileUp,
  },
  {
    to: '/books',
    label: 'Kitablar',
    description: 'Arxiv, taglar və emal tarixçəsi',
    icon: Library,
  },
  {
    to: '/taxonomy',
    label: 'Fənn və kateqoriyalar',
    description: 'Proqramlar, fənnlər, kateqoriya ağacı',
    icon: ListTree,
  },
]

function workedCount(book: Book) {
  return book.worked_pages.length
}

function isDone(book: Book) {
  return book.page_count !== null && workedCount(book) >= book.page_count
}

function isInProgress(book: Book) {
  return workedCount(book) > 0 && !isDone(book)
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card className="gap-1 py-4">
      <CardHeader className="px-4">
        <CardDescription className="font-mono text-[11px] tracking-[0.14em] uppercase">
          {label}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-4">
        <p className="text-2xl font-semibold tracking-tight tabular-nums">
          {value}
        </p>
      </CardContent>
    </Card>
  )
}

function InProgressList({ books }: { books: Book[] }) {
  if (!books.length) {
    return (
      <p className="text-muted-foreground text-sm">
        Yarımçıq kitab yoxdur — yeni import başladıqda burada görünəcək.
      </p>
    )
  }
  return (
    <ul className="divide-y">
      {books.map((book) => {
        const worked = workedCount(book)
        const total = book.page_count
        return (
          <li key={book.id} className="flex items-center gap-4 py-3">
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-sm font-medium">
                  {book.title}
                </span>
                <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                  {total ? `${worked}/${total} səhifə` : `${worked} səhifə`}
                </span>
              </div>
              <Progress
                value={total ? (worked / total) * 100 : 0}
                className="h-1.5"
              />
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to={`/import?book=${book.id}`}>
                Davam et
                <ArrowRight data-icon="inline-end" />
              </Link>
            </Button>
          </li>
        )
      })}
    </ul>
  )
}

export function DashboardPage() {
  usePageTitle('İcmal')
  const books = useBooks()

  if (books.isPending) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-40" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-48" />
      </div>
    )
  }

  if (books.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          Məlumatlar yüklənmədi: {normalizeError(books.error).message}
        </AlertDescription>
      </Alert>
    )
  }

  const all = books.data
  const inProgress = all.filter(isInProgress)
  const done = all.filter(isDone)
  const workedPages = all.reduce((sum, b) => sum + workedCount(b), 0)

  return (
    <div className="space-y-8">
      <div>
        <p className="text-muted-foreground font-mono text-[11px] tracking-[0.18em] uppercase">
          Asansinaq · sual bazası
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">İcmal</h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Kitab" value={all.length} />
        <StatCard label="Davam edən" value={inProgress.length} />
        <StatCard label="Tamamlanan" value={done.length} />
        <StatCard label="İşlənən səhifə" value={workedPages} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Davam edən kitablar</CardTitle>
          <CardDescription>
            Yarımçıq qalan emalı qaldığı səhifədən davam etdirin.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <InProgressList books={inProgress} />
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        {QUICK_ACTIONS.map((action) => (
          <Link
            key={action.to}
            to={action.to}
            className="focus-visible:ring-ring rounded-xl focus-visible:ring-2 focus-visible:outline-none"
          >
            <Card className="hover:bg-accent/50 h-full gap-1 py-4 transition-colors">
              <CardHeader className="px-4">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <action.icon className="text-muted-foreground size-4" />
                  {action.label}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4">
                <p className="text-muted-foreground text-sm">
                  {action.description}
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}

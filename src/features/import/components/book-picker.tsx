import { useState } from 'react'
import { Archive, ChevronDown } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import { useBooks, type Book } from '@/features/books'

interface BookPickerProps {
  disabled?: boolean
  onPick: (book: Book) => void
}

// Searchable archive: type to filter by title. Rows without an archived file
// (oversize uploads) stay visible but disabled — the metadata exists, the
// bytes do not.
export function BookPicker({ disabled, onPick }: BookPickerProps) {
  const books = useBooks()
  const [open, setOpen] = useState(false)
  const list = books.data ?? []

  // A failed load must not silently hide the archive: the toolbar hint next
  // to this button still tells the operator to pick from it.
  if (books.isError) {
    return (
      <Button
        variant="outline"
        className="text-destructive"
        onClick={() => books.refetch()}
        disabled={books.isFetching}
      >
        {books.isFetching ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <Archive data-icon="inline-start" />
        )}
        Arxiv yüklənmədi — yenidən cəhd et
      </Button>
    )
  }

  if (!books.isPending && list.length === 0) return null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" disabled={disabled || books.isPending}>
          <Archive data-icon="inline-start" />
          {books.isPending ? 'Arxiv yüklənir…' : 'Arxivdən seç'}
          <ChevronDown data-icon="inline-end" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="start">
        <Command>
          <CommandInput placeholder="Kitab axtar…" />
          <CommandList>
            <CommandEmpty>Kitab tapılmadı.</CommandEmpty>
            <CommandGroup>
              {list.map((book) => (
                <CommandItem
                  key={book.id}
                  // Unique per book (two books can share a title); search
                  // still matches via keywords.
                  value={String(book.id)}
                  keywords={[book.title, book.subjects?.name ?? '']}
                  disabled={book.storage_path === null}
                  onSelect={() => {
                    setOpen(false)
                    onPick(book)
                  }}
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate">{book.title}</span>
                    <span className="flex flex-wrap items-center gap-1">
                      {book.programs ? (
                        <Badge variant="outline">{book.programs.name}</Badge>
                      ) : null}
                      {book.subjects ? (
                        <Badge variant="secondary">{book.subjects.name}</Badge>
                      ) : null}
                      {book.storage_path === null ? (
                        <Badge variant="outline">arxiv faylı yoxdur</Badge>
                      ) : null}
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

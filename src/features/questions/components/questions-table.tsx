import { Badge } from '@/components/ui/badge'
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
import {
  useSignedUrls,
  type QuestionListItem,
} from '@/features/questions/api/questions'
import { parseFlags } from '@/features/questions/lib/row'
import { STATUS_LABEL } from '@/features/questions/lib/status'

const STATUS_CLASS: Record<string, string> = {
  cropped: 'border-muted-foreground/20 bg-muted text-muted-foreground',
  structured: 'border-sky-200 bg-sky-50 text-sky-700',
  approved: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  rejected: 'border-muted-foreground/20 bg-muted text-muted-foreground',
  failed: 'border-destructive/30 bg-destructive/10 text-destructive',
}

function SelectBox({
  checked,
  label,
  onChange,
}: {
  checked: boolean
  label: string
  onChange: () => void
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation()
        onChange()
      }}
      className={cn(
        'flex size-4.5 items-center justify-center rounded border text-[10px] transition-colors',
        checked
          ? 'bg-primary border-primary text-primary-foreground'
          : 'bg-background hover:border-primary/50',
      )}
    >
      {checked ? '✓' : ''}
    </button>
  )
}

// The crop thumbnail is what makes the list scannable: a row of numbers and
// statuses tells the operator nothing about WHICH question it is.
export function QuestionsTable({
  items,
  selected,
  onToggle,
  onToggleAll,
  onOpen,
}: {
  items: QuestionListItem[]
  selected: Set<number>
  onToggle: (id: number) => void
  onToggleAll: () => void
  onOpen: (item: QuestionListItem) => void
}) {
  const signed = useSignedUrls(items.map((i) => i.crop_path))
  const allSelected = items.length > 0 && items.every((i) => selected.has(i.id))

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-8">
            <SelectBox
              checked={allSelected}
              label="Hamısını seç"
              onChange={onToggleAll}
            />
          </TableHead>
          <TableHead className="w-24">Görüntü</TableHead>
          <TableHead>Kitab / yer</TableHead>
          <TableHead>Sual</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Qeydlər</TableHead>
          <TableHead className="text-right">Cavab</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((q) => {
          const flags = parseFlags(q.flags)
          const errors = flags.filter((f) => f.level === 'error').length
          const url = signed.data?.get(q.crop_path)
          const isSelected = selected.has(q.id)
          return (
            <TableRow
              key={q.id}
              data-state={isSelected ? 'selected' : undefined}
              className="cursor-pointer"
              onClick={() => onOpen(q)}
            >
              <TableCell onClick={(e) => e.stopPropagation()}>
                <SelectBox
                  checked={isSelected}
                  label={`${q.q_no} nömrəli sualı seç`}
                  onChange={() => onToggle(q.id)}
                />
              </TableCell>
              <TableCell>
                {url ? (
                  <img
                    src={url}
                    alt=""
                    loading="lazy"
                    className="h-12 w-20 rounded border bg-white object-cover object-left-top"
                  />
                ) : (
                  <Skeleton className="h-12 w-20" />
                )}
              </TableCell>
              <TableCell className="max-w-48">
                <span className="block truncate font-medium">
                  {q.bookTitle ?? '—'}
                </span>
                <span className="text-muted-foreground text-xs">
                  s.{q.page_number} · sütun {q.col + 1}
                  {q.test_no ? ` · test ${q.test_no}` : ''}
                </span>
              </TableCell>
              <TableCell className="max-w-72">
                <span className="block truncate text-sm">
                  №{q.q_no}
                  {q.stem ? ` — ${q.stem.replace(/\$/g, '').slice(0, 60)}` : ''}
                </span>
              </TableCell>
              <TableCell>
                <Badge variant="outline" className={cn(STATUS_CLASS[q.status])}>
                  {STATUS_LABEL[q.status]}
                </Badge>
              </TableCell>
              <TableCell>
                {flags.length ? (
                  <span
                    className={cn(
                      'text-xs',
                      errors ? 'text-destructive' : 'text-amber-700',
                    )}
                  >
                    {errors ? `${errors} xəta` : `${flags.length} qeyd`}
                  </span>
                ) : q.verified ? (
                  <span className="text-xs text-emerald-700">təmiz</span>
                ) : (
                  <span className="text-muted-foreground text-xs">—</span>
                )}
              </TableCell>
              <TableCell className="text-right">
                {q.answer ? (
                  <Badge
                    variant="outline"
                    className={
                      q.answer_source === 'reviewer'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-sky-200 bg-sky-50 text-sky-700'
                    }
                  >
                    {q.answer}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground text-xs">—</span>
                )}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

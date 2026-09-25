import { useMemo, useState } from 'react'
import { Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { normalizeError } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { DIFFICULTY_LABEL } from '@/core/questions/difficulty'
import type { Category } from '@/features/taxonomy'
import { pickQuestions } from '@/features/exams/api/draft'
import { useFacets } from '@/features/exams/api/search'
import type { BuilderQuestion } from '@/features/exams/schemas'
import {
  DIFFICULTIES,
  planRecipe,
  type Difficulty,
  type Mix,
} from '@/features/exams/lib/recipe'
import { DifficultyDot } from '@/features/exams/components/builder/difficulty-badge'

type MixMode = 'balanced' | 'bank' | 'custom'

const BALANCED: Mix = { 1: 20, 2: 60, 3: 20 }

// "Fill the rest of this section" as a recipe: which topics, what mix of
// difficulty, whether questions already used elsewhere may come back. The
// plan is shown BEFORE the draw, worked out against what the bank actually
// holds, so a recipe the bank cannot meet says so here — and, if allowed,
// covers a dry difficulty from its neighbour — instead of coming back short
// after the button.
export function AutofillDialog({
  open,
  onOpenChange,
  examId,
  subjectId,
  subjectName,
  remaining,
  capacity,
  sectionQuestions,
  categories,
  examQuestions,
  onFilled,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  examId: number
  subjectId: number
  subjectName: string
  remaining: number
  capacity: number
  /** What the section being filled already holds. */
  sectionQuestions: BuilderQuestion[]
  categories: Category[]
  /** Every question already in the exam — they cannot be drawn again. */
  examQuestions: BuilderQuestion[]
  onFilled: (questions: BuilderQuestion[]) => void
}) {
  const [unusedOnly, setUnusedOnly] = useState(true)
  const [backfill, setBackfill] = useState(true)
  const [mode, setMode] = useState<MixMode>('balanced')
  const [custom, setCustom] = useState<Mix>(BALANCED)
  const [excluded, setExcluded] = useState<ReadonlySet<number>>(new Set())
  const [running, setRunning] = useState(false)

  const facets = useFacets(
    open
      ? {
          subjectId,
          categoryIds: [],
          difficulties: [],
          figures: 'any',
          search: '',
          unusedOnly,
          examId,
        }
      : null,
  )

  const available = useMemo(() => {
    const cell = new Map<string, number>()
    for (const f of facets.data ?? []) {
      if (f.category_id === null) continue
      const d = f.difficulty ?? 0
      cell.set(
        `${f.category_id}:${d}`,
        (cell.get(`${f.category_id}:${d}`) ?? 0) + f.n,
      )
      cell.set(
        `${f.category_id}:*`,
        (cell.get(`${f.category_id}:*`) ?? 0) + f.n,
      )
    }
    // What the exam already holds is counted by the facets but cannot be
    // drawn again.
    for (const q of examQuestions) {
      if (q.categoryId === null) continue
      const d = q.difficulty ?? 0
      const k = `${q.categoryId}:${d}`
      if (cell.has(k)) cell.set(k, cell.get(k)! - 1)
      const any = `${q.categoryId}:*`
      if (cell.has(any)) cell.set(any, cell.get(any)! - 1)
    }
    return (t: number, d: Difficulty | null) =>
      Math.max(0, cell.get(`${t}:${d ?? '*'}`) ?? 0)
  }, [facets.data, examQuestions])

  const topics = useMemo(
    () =>
      categories
        .filter((c) => !excluded.has(c.id) && available(c.id, null) > 0)
        .map((c) => c.id),
    [categories, excluded, available],
  )

  const mix: Mix | null =
    mode === 'bank' ? null : mode === 'balanced' ? BALANCED : custom
  const customSum = custom[1] + custom[2] + custom[3]
  const mixInvalid = mode === 'custom' && customSum !== 100

  const existing = useMemo(() => {
    const byTopic = new Map<number, number>()
    const byDifficulty = { 1: 0, 2: 0, 3: 0 } as Record<Difficulty, number>
    for (const q of sectionQuestions) {
      if (q.categoryId !== null)
        byTopic.set(q.categoryId, (byTopic.get(q.categoryId) ?? 0) + 1)
      if (q.difficulty === 1 || q.difficulty === 2 || q.difficulty === 3)
        byDifficulty[q.difficulty] += 1
    }
    return { capacity, byTopic, byDifficulty }
  }, [sectionQuestions, capacity])

  const plan = useMemo(
    () => planRecipe({ topics, remaining, mix, available, backfill, existing }),
    [topics, remaining, mix, available, backfill, existing],
  )

  const perTopic = useMemo(() => {
    const out = new Map<number, Record<string, number>>()
    for (const c of plan.cells) {
      const row = out.get(c.category_id) ?? {}
      const key = c.difficulty === null ? 'any' : String(c.difficulty)
      row[key] = (row[key] ?? 0) + c.count
      out.set(c.category_id, row)
    }
    return out
  }, [plan.cells])

  const run = async () => {
    setRunning(true)
    try {
      const picked = await pickQuestions(examId, plan.cells, unusedOnly)
      onFilled(picked)
      if (picked.length < plan.planned) {
        toast.warning(
          `${picked.length} sual əlavə olundu. ${plan.planned - picked.length} sual tapılmadı — başqa admin eyni anda istifadə etmiş ola bilər.`,
        )
      } else {
        toast.success(`${picked.length} sual əlavə olundu`)
      }
      onOpenChange(false)
    } catch (error) {
      toast.error(normalizeError(error).message)
    } finally {
      setRunning(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Avtomatik doldur · {subjectName}</DialogTitle>
          <DialogDescription>
            {remaining} boş yer qalıb. Resepti seçin, plan aşağıda bankın real
            vəziyyətinə görə hesablanır.
          </DialogDescription>
        </DialogHeader>

        {remaining === 0 ? (
          <p className="text-muted-foreground py-4 text-sm">
            Bu bölmə artıq doludur.
          </p>
        ) : (
          <div className="flex flex-col gap-5">
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">Çətinlik qarışığı</h3>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    {
                      key: 'balanced',
                      title: 'Balanslı',
                      hint: '20 / 60 / 20',
                    },
                    {
                      key: 'bank',
                      title: 'Bank kimi',
                      hint: 'çətinlik seçilmir',
                    },
                    {
                      key: 'custom',
                      title: 'Xüsusi',
                      hint: 'faizləri özünüz verin',
                    },
                  ] as const
                ).map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => setMode(o.key)}
                    className={cn(
                      'rounded-md border px-3 py-2 text-left text-sm transition-colors',
                      mode === o.key
                        ? 'border-primary bg-primary/5'
                        : 'hover:bg-muted',
                    )}
                  >
                    <span className="block font-medium">{o.title}</span>
                    <span className="text-muted-foreground text-xs">
                      {o.hint}
                    </span>
                  </button>
                ))}
              </div>
              {mode === 'custom' ? (
                <div className="flex items-end gap-3">
                  {DIFFICULTIES.map((d) => (
                    <label key={d} className="flex flex-col gap-1 text-xs">
                      <span className="inline-flex items-center gap-1 capitalize">
                        <DifficultyDot value={d} /> {DIFFICULTY_LABEL[d]} %
                      </span>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        className="w-20"
                        value={custom[d]}
                        onChange={(e) =>
                          setCustom({
                            ...custom,
                            [d]: Math.max(0, Number(e.target.value) || 0),
                          })
                        }
                      />
                    </label>
                  ))}
                  <span
                    className={cn(
                      'pb-2 text-xs',
                      mixInvalid ? 'text-destructive' : 'text-muted-foreground',
                    )}
                  >
                    cəmi {customSum}%
                  </span>
                </div>
              ) : null}
            </section>

            <section className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">Mövzular və plan</h3>
                {facets.isFetching ? <Spinner className="size-3.5" /> : null}
              </div>
              <div className="max-h-64 overflow-y-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-muted-foreground sticky top-0 text-xs">
                    <tr>
                      <th className="px-3 py-1.5 text-left font-medium">
                        Mövzu
                      </th>
                      {mix ? (
                        DIFFICULTIES.map((d) => (
                          <th
                            key={d}
                            className="w-16 px-2 py-1.5 text-right font-medium capitalize"
                          >
                            {DIFFICULTY_LABEL[d]}
                          </th>
                        ))
                      ) : (
                        <th className="w-16 px-2 py-1.5 text-right font-medium">
                          sual
                        </th>
                      )}
                      <th className="w-20 px-3 py-1.5 text-right font-medium">
                        bankda
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {categories.map((c) => {
                      const has = available(c.id, null)
                      const on = !excluded.has(c.id) && has > 0
                      const row = perTopic.get(c.id) ?? {}
                      return (
                        <tr
                          key={c.id}
                          className={cn('border-t', !on && 'opacity-50')}
                        >
                          <td className="px-3 py-1.5">
                            <label className="flex items-center gap-2">
                              <Checkbox
                                checked={on}
                                disabled={has === 0}
                                onCheckedChange={() => {
                                  const next = new Set(excluded)
                                  if (next.has(c.id)) next.delete(c.id)
                                  else next.add(c.id)
                                  setExcluded(next)
                                }}
                              />
                              <span className="truncate">{c.name}</span>
                            </label>
                          </td>
                          {mix ? (
                            DIFFICULTIES.map((d) => (
                              <td
                                key={d}
                                className="px-2 py-1.5 text-right tabular-nums"
                              >
                                {row[String(d)] ?? '·'}
                              </td>
                            ))
                          ) : (
                            <td className="px-2 py-1.5 text-right tabular-nums">
                              {row.any ?? '·'}
                            </td>
                          )}
                          <td className="text-muted-foreground px-3 py-1.5 text-right tabular-nums">
                            {has}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-sm">
                Plan:{' '}
                <span className="font-medium tabular-nums">{plan.planned}</span>{' '}
                / {remaining} sual
                {plan.substituted > 0 ? (
                  <span className="text-muted-foreground">
                    {' '}
                    · {plan.substituted} sual qonşu çətinlikdən
                  </span>
                ) : null}
                {plan.shortfall > 0 ? (
                  <span className="text-destructive">
                    {' '}
                    · {plan.shortfall} sual üçün bankda uyğun sual yoxdur
                  </span>
                ) : null}
              </p>
            </section>

            <section className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="af-unused" className="font-normal">
                  Başqa denemədə olan sualları götürmə
                </Label>
                <Switch
                  id="af-unused"
                  checked={unusedOnly}
                  onCheckedChange={setUnusedOnly}
                />
              </div>
              {mix ? (
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="af-backfill" className="font-normal">
                    Çatışmayan çətinliyi qonşu çətinliklə tamamla
                  </Label>
                  <Switch
                    id="af-backfill"
                    checked={backfill}
                    onCheckedChange={setBackfill}
                  />
                </div>
              ) : null}
            </section>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Ləğv et
          </Button>
          <Button
            onClick={() => void run()}
            disabled={
              running ||
              remaining === 0 ||
              plan.planned === 0 ||
              mixInvalid ||
              facets.isPending
            }
          >
            {running ? <Spinner className="size-4" /> : <Wand2 />}
            {plan.planned > 0 ? `${plan.planned} sual əlavə et` : 'Doldur'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

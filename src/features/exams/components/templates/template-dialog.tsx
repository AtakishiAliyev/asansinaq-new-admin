import { useEffect } from 'react'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { normalizeError } from '@/lib/errors'
import type { Subject } from '@/features/taxonomy'
import { useSaveTemplate } from '@/features/exams/api/templates'
import {
  templateFormSchema,
  type Template,
  type TemplateFormValues,
} from '@/features/exams/schemas'
import { scoreLabel } from '@/features/exams/lib/format'

function toForm(t: Template | null, subjects: Subject[]): TemplateFormValues {
  if (!t) {
    return {
      name: '',
      name_pattern: 'Deneme {nn}',
      duration_minutes: 30,
      navigation: 'free',
      pause_on_exit: true,
      allow_retake: true,
      reveal_answers: 'after_submit',
      base_score: 0,
      min_score: 0,
      sections: [
        {
          subject_id: subjects[0]?.id ?? 0,
          question_count: 30,
          duration_minutes: null,
          points_correct: 1,
          penalty_ratio: 0,
        },
      ],
    }
  }
  return {
    name: t.name,
    name_pattern: t.name_pattern,
    duration_minutes: Math.round(t.duration_seconds / 60),
    navigation: t.navigation,
    pause_on_exit: t.pause_on_exit,
    allow_retake: t.allow_retake,
    reveal_answers: t.reveal_answers,
    base_score: t.base_score,
    min_score: t.min_score,
    sections: t.sections.map((s) => ({
      subject_id: s.subject_id,
      question_count: s.question_count,
      duration_minutes: s.duration_seconds
        ? Math.round(s.duration_seconds / 60)
        : null,
      points_correct: s.points_correct,
      penalty_ratio: s.penalty_ratio,
    })),
  }
}

// One template's rules. Everything a new program needs is here — sections
// and their subjects, time, navigation, retakes, the score — so SAT or DİM
// arrive as a filled form, not as code.
export function TemplateDialog({
  open,
  onOpenChange,
  programId,
  template,
  subjects,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  programId: number
  /** Null to create a new one. */
  template: Template | null
  subjects: Subject[]
}) {
  const save = useSaveTemplate(programId)
  const form = useForm<TemplateFormValues>({
    resolver: zodResolver(templateFormSchema),
    defaultValues: toForm(template, subjects),
  })
  const { register, control, handleSubmit, reset, formState, setValue } = form
  const sections = useFieldArray({ control, name: 'sections' })

  useEffect(() => {
    if (open) reset(toForm(template, subjects))
  }, [open, template, subjects, reset])

  // Watched once, at the top: reading them inside the section rows would
  // call a hook per row, and adding a row would change the hook count.
  const [liveSections, liveBase, navigation, pauseOnExit, allowRetake, reveal] =
    useWatch({
      control,
      name: [
        'sections',
        'base_score',
        'navigation',
        'pause_on_exit',
        'allow_retake',
        'reveal_answers',
      ],
    })
  const totalQuestions = (liveSections ?? []).reduce(
    (s, x) => s + (Number(x?.question_count) || 0),
    0,
  )
  const maxScore =
    (Number(liveBase) || 0) +
    (liveSections ?? []).reduce(
      (s, x) =>
        s + (Number(x?.question_count) || 0) * (Number(x?.points_correct) || 0),
      0,
    )

  const onSubmit = handleSubmit((values) =>
    save.mutate(
      { id: template?.id ?? null, values },
      {
        onSuccess: () => {
          toast.success('Şablon yadda saxlanıldı')
          onOpenChange(false)
        },
        onError: (e) => toast.error(normalizeError(e).message),
      },
    ),
  )

  const num = { valueAsNumber: true } as const

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{template ? template.name : 'Yeni şablon'}</DialogTitle>
          <DialogDescription>
            Dəyişikliklər yalnız bundan sonra dərc olunan versiyalara təsir
            edir. Şablondan deneme yaradılıbsa, bölmələrin sırası və fənləri
            dəyişməz qalır.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Ad" error={formState.errors.name?.message}>
              <Input {...register('name')} placeholder="Tam TR-YÖS" />
            </Field>
            <Field
              label="Deneme adı şablonu"
              hint="{nn} nömrə ilə əvəz olunur"
              error={formState.errors.name_pattern?.message}
            >
              <Input
                {...register('name_pattern')}
                placeholder="TR-YÖS Deneme {nn}"
              />
            </Field>
            <Field
              label="Ümumi vaxt (dəqiqə)"
              error={formState.errors.duration_minutes?.message}
            >
              <Input
                type="number"
                min={1}
                {...register('duration_minutes', num)}
              />
            </Field>
            <Field label="Keçid">
              <Select
                value={navigation}
                onValueChange={(v) =>
                  setValue(
                    'navigation',
                    v as TemplateFormValues['navigation'],
                    { shouldDirty: true },
                  )
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="free">
                    Sərbəst — istənilən suala keçmək olar
                  </SelectItem>
                  <SelectItem value="linear">Ardıcıl — yalnız irəli</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field
              label="Baza bal"
              hint="Hər tələbəyə verilən bal"
              error={formState.errors.base_score?.message}
            >
              <Input
                type="number"
                step="any"
                min={0}
                {...register('base_score', num)}
              />
            </Field>
            <Field
              label="Minimum bal"
              error={formState.errors.min_score?.message}
            >
              <Input
                type="number"
                step="any"
                min={0}
                {...register('min_score', num)}
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Toggle
              label="Çıxanda vaxt dayansın"
              checked={pauseOnExit}
              onChange={(v) =>
                setValue('pause_on_exit', v, { shouldDirty: true })
              }
            />
            <Toggle
              label="Təkrar işləmək olar"
              checked={allowRetake}
              onChange={(v) =>
                setValue('allow_retake', v, { shouldDirty: true })
              }
            />
            <Toggle
              label="Bitirəndə cavablar görünsün"
              checked={reveal === 'after_submit'}
              onChange={(v) =>
                setValue('reveal_answers', v ? 'after_submit' : 'never', {
                  shouldDirty: true,
                })
              }
            />
          </div>

          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Bölmələr</h3>
              <span className="text-muted-foreground text-xs">
                {totalQuestions} sual · maks. {scoreLabel(maxScore)} bal
              </span>
            </div>
            <div className="text-muted-foreground grid grid-cols-[1fr_72px_88px_150px_76px_auto] gap-2 px-1 text-xs">
              <span>Fənn</span>
              <span>Sual</span>
              <span>Düzün balı</span>
              <span>Cərimə</span>
              <span>Vaxt, dəq</span>
              <span />
            </div>
            {sections.fields.map((field, i) => (
              <div
                key={field.id}
                className="grid grid-cols-[1fr_72px_88px_150px_76px_auto] items-center gap-2"
              >
                <Select
                  value={String(liveSections?.[i]?.subject_id ?? '')}
                  onValueChange={(v) =>
                    setValue(`sections.${i}.subject_id`, Number(v), {
                      shouldDirty: true,
                    })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Fənn" />
                  </SelectTrigger>
                  <SelectContent>
                    {subjects.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  min={1}
                  {...register(`sections.${i}.question_count`, num)}
                />
                <Input
                  type="number"
                  step="any"
                  min={0}
                  {...register(`sections.${i}.points_correct`, num)}
                />
                <Select
                  value={String(liveSections?.[i]?.penalty_ratio ?? 0)}
                  onValueChange={(v) =>
                    setValue(`sections.${i}.penalty_ratio`, Number(v), {
                      shouldDirty: true,
                    })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">yoxdur</SelectItem>
                    <SelectItem value="0.25">4 səhv = 1 düz</SelectItem>
                    <SelectItem value="0.3333">3 səhv = 1 düz</SelectItem>
                    <SelectItem value="0.5">2 səhv = 1 düz</SelectItem>
                    <SelectItem value="1">1 səhv = 1 düz</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  min={1}
                  placeholder="ümumi"
                  {...register(`sections.${i}.duration_minutes`, {
                    setValueAs: (v: unknown) =>
                      v === '' || v === null || v === undefined
                        ? null
                        : Number(v),
                  })}
                />
                <div className="flex">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    disabled={i === 0}
                    onClick={() => sections.move(i, i - 1)}
                    aria-label="Yuxarı"
                  >
                    <ArrowUp className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    disabled={i === sections.fields.length - 1}
                    onClick={() => sections.move(i, i + 1)}
                    aria-label="Aşağı"
                  >
                    <ArrowDown className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    disabled={sections.fields.length === 1}
                    onClick={() => sections.remove(i)}
                    aria-label="Sil"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))}
            {formState.errors.sections?.message ? (
              <p className="text-destructive text-xs">
                {formState.errors.sections.message}
              </p>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() =>
                sections.append({
                  subject_id:
                    subjects.find(
                      (s) =>
                        !(liveSections ?? []).some(
                          (x) => x?.subject_id === s.id,
                        ),
                    )?.id ??
                    subjects[0]?.id ??
                    0,
                  question_count: 10,
                  duration_minutes: null,
                  points_correct: 1,
                  penalty_ratio: 0,
                })
              }
            >
              <Plus /> Bölmə əlavə et
            </Button>
          </section>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Ləğv et
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? <Spinner className="size-4" /> : null} Yadda
              saxla
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-sm">{label}</Label>
      {children}
      {error ? (
        <p className="text-destructive text-xs">{error}</p>
      ) : hint ? (
        <p className="text-muted-foreground text-xs">{hint}</p>
      ) : null}
    </div>
  )
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
      {label}
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  )
}

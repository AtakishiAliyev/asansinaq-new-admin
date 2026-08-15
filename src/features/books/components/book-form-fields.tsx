import { useState } from 'react'
import { X } from 'lucide-react'
import {
  Controller,
  type Control,
  type UseFormRegister,
  type FieldErrors,
} from 'react-hook-form'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { usePrograms, useSubjects } from '@/features/taxonomy'
import type { BookFormValues } from '@/features/books/schemas'

interface BookFormFieldsProps {
  control: Control<BookFormValues>
  register: UseFormRegister<BookFormValues>
  errors: FieldErrors<BookFormValues>
  programId: number | null
  onProgramChange: (id: number) => void
}

// Shared by the upload dialog and the edit dialog. The subject list follows
// the chosen program; changing program clears the subject (the DB enforces the
// same-program rule anyway — this keeps the UI from ever offering a bad pair).
export function BookFormFields({
  control,
  register,
  errors,
  programId,
  onProgramChange,
}: BookFormFieldsProps) {
  const programs = usePrograms()
  const subjects = useSubjects(programId)
  const [tagDraft, setTagDraft] = useState('')

  function commitTagDraft(
    current: string[],
    onChange: (tags: string[]) => void,
  ) {
    // Re-trim after the slice: a 40+ char draft can end in whitespace, which
    // would dodge the duplicate check and store a dup after zod's trim.
    const tag = tagDraft.trim().slice(0, 40).trim()
    if (tag && !current.includes(tag)) onChange([...current, tag])
    setTagDraft('')
  }

  return (
    <FieldGroup>
      <Field data-invalid={errors.title ? true : undefined}>
        <FieldLabel htmlFor="book-title">Ad</FieldLabel>
        <Input
          id="book-title"
          {...register('title')}
          aria-invalid={errors.title ? true : undefined}
        />
        <FieldError errors={[errors.title]} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field data-invalid={errors.program_id ? true : undefined}>
          <FieldLabel>Proqram</FieldLabel>
          <Controller
            control={control}
            name="program_id"
            render={({ field }) => (
              <Select
                value={field.value ? String(field.value) : ''}
                onValueChange={(v) => {
                  field.onChange(Number(v))
                  onProgramChange(Number(v))
                }}
              >
                <SelectTrigger
                  aria-label="Proqram"
                  aria-invalid={errors.program_id ? true : undefined}
                >
                  <SelectValue placeholder="Seçin" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {(programs.data ?? []).map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            )}
          />
          <FieldError errors={[errors.program_id]} />
        </Field>

        <Field>
          <FieldLabel>Fənn</FieldLabel>
          <Controller
            control={control}
            name="subject_id"
            render={({ field }) => (
              <Select
                value={field.value ? String(field.value) : 'none'}
                disabled={programId === null}
                onValueChange={(v) =>
                  field.onChange(v === 'none' ? null : Number(v))
                }
              >
                <SelectTrigger aria-label="Fənn">
                  <SelectValue placeholder="Seçin" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="none">Qarışıq / seçilməyib</SelectItem>
                    {(subjects.data ?? []).map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            )}
          />
          <FieldDescription>Tək-fənnli kitab üçün seçin.</FieldDescription>
        </Field>
      </div>

      <Field data-invalid={errors.tags ? true : undefined}>
        <FieldLabel htmlFor="book-tags">Taglar</FieldLabel>
        <Controller
          control={control}
          name="tags"
          render={({ field }) => (
            <div className="flex flex-col gap-2">
              {field.value.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {field.value.map((tag) => (
                    <Badge key={tag} variant="secondary" className="gap-1">
                      {tag}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="size-4"
                        aria-label={`${tag} tagını sil`}
                        onClick={() =>
                          field.onChange(field.value.filter((t) => t !== tag))
                        }
                      >
                        <X />
                      </Button>
                    </Badge>
                  ))}
                </div>
              ) : null}
              <Input
                id="book-tags"
                value={tagDraft}
                placeholder="tag yazıb Enter basın"
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return
                  e.preventDefault()
                  commitTagDraft(field.value, field.onChange)
                }}
                // Blur fires before the submit button's click, so a typed but
                // uncommitted tag rides along instead of being silently lost.
                onBlur={() => commitTagDraft(field.value, field.onChange)}
              />
            </div>
          )}
        />
        <FieldError errors={[errors.tags]} />
      </Field>

      <Field data-invalid={errors.note ? true : undefined}>
        <FieldLabel htmlFor="book-note">Qeyd</FieldLabel>
        <Textarea
          id="book-note"
          rows={2}
          placeholder="məs. cavablar səh. 400-420-də"
          {...register('note')}
        />
        <FieldError errors={[errors.note]} />
      </Field>
    </FieldGroup>
  )
}

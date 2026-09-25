import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { normalizeError } from '@/lib/errors'
import { examKeys } from '@/features/exams/api/keys'
import {
  useDraft,
  useSaveSection,
  type DraftSections,
} from '@/features/exams/api/draft'
import type { BuilderQuestion, Template } from '@/features/exams/schemas'

export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

const SAVE_DELAY_MS = 500

// The builder's working copy of the draft, and the saving of it.
//
// The page edits a LOCAL copy — adding, removing, dragging, swapping must
// answer the hand at once, not after a round trip — and each touched section
// is written back half a second after the last change to it. The server
// copy is adopted only when it is newer than the last successful save and
// nothing is waiting to be written: a refetch that finished before an edit
// was saved would otherwise put back what the admin had just changed.
export function useBuilder(examId: number, template: Template) {
  const queryClient = useQueryClient()
  const draft = useDraft(examId)
  const saveSection = useSaveSection(examId)

  const [sections, setSections] = useState<DraftSections>(new Map())
  const [syncedAt, setSyncedAt] = useState(0)
  const [lastSavedAt, setLastSavedAt] = useState(0)
  const [pending, setPending] = useState<ReadonlySet<number>>(new Set())
  const [saving, setSaving] = useState(0)
  const [failed, setFailed] = useState(false)
  const [active, setActive] = useState(template.sections[0]?.position ?? 1)

  // Adopting the server copy is state derived from props, so it is done
  // during render — React's own pattern for it — rather than in an effect
  // that would paint the stale copy first.
  if (
    draft.data &&
    draft.dataUpdatedAt !== syncedAt &&
    draft.dataUpdatedAt > lastSavedAt &&
    pending.size === 0 &&
    saving === 0
  ) {
    setSyncedAt(draft.dataUpdatedAt)
    setSections(draft.data)
  }

  // Handlers run between renders; they read the newest copy from here so a
  // second key press before the re-render does not work on a stale list.
  const latest = useRef(sections)
  useLayoutEffect(() => {
    latest.current = sections
  }, [sections])

  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())
  const refetchAfter = useRef(new Set<number>())

  const write = useCallback(
    (section: number, list: BuilderQuestion[]) => {
      setSaving((n) => n + 1)
      saveSection.mutate(
        { section, ids: list.map((q) => q.id) },
        {
          onSuccess: () => {
            setLastSavedAt(Date.now())
            setFailed(false)
            if (refetchAfter.current.delete(section)) {
              // Picked questions arrive without their "used elsewhere"
              // count; the draft read brings it.
              void queryClient.invalidateQueries({
                queryKey: examKeys.draft(examId),
              })
            }
          },
          onError: (error) => {
            toast.error(normalizeError(error).message)
            setFailed(true)
            // Put the page back to what the server actually holds.
            for (const t of timers.current.values()) clearTimeout(t)
            timers.current.clear()
            setPending(new Set())
            void queryClient.invalidateQueries({
              queryKey: examKeys.draft(examId),
            })
          },
          onSettled: () => setSaving((n) => n - 1),
        },
      )
    },
    [saveSection, queryClient, examId],
  )

  const commit = useCallback(
    (
      section: number,
      list: BuilderQuestion[],
      options?: { refetch?: boolean },
    ) => {
      const next = new Map(latest.current)
      next.set(section, list)
      latest.current = next
      setSections(next)
      setPending((s) => new Set(s).add(section))
      if (options?.refetch) refetchAfter.current.add(section)

      const existing = timers.current.get(section)
      if (existing) clearTimeout(existing)
      timers.current.set(
        section,
        setTimeout(() => {
          timers.current.delete(section)
          setPending((s) => {
            const n = new Set(s)
            n.delete(section)
            return n
          })
          write(section, latest.current.get(section) ?? [])
        }, SAVE_DELAY_MS),
      )
    },
    [write],
  )

  const capacityOf = useCallback(
    (section: number) =>
      template.sections.find((s) => s.position === section)?.question_count ??
      0,
    [template.sections],
  )

  const idsInExam = useMemo(() => {
    const ids = new Set<number>()
    for (const list of sections.values()) for (const q of list) ids.add(q.id)
    return ids
  }, [sections])

  /** Adds to the active section. False when it is full or already there. */
  const add = useCallback(
    (q: BuilderQuestion): boolean => {
      for (const list of latest.current.values())
        if (list.some((x) => x.id === q.id)) return false
      const list = latest.current.get(active) ?? []
      if (list.length >= capacityOf(active)) return false
      commit(active, [...list, q])
      return true
    },
    [active, capacityOf, commit],
  )

  const appendMany = useCallback(
    (section: number, qs: BuilderQuestion[]) => {
      const list = latest.current.get(section) ?? []
      const room = capacityOf(section) - list.length
      commit(section, [...list, ...qs.slice(0, Math.max(0, room))], {
        refetch: true,
      })
    },
    [capacityOf, commit],
  )

  const remove = useCallback(
    (section: number, questionId: number) => {
      const list = latest.current.get(section) ?? []
      commit(
        section,
        list.filter((q) => q.id !== questionId),
      )
    },
    [commit],
  )

  const move = useCallback(
    (section: number, from: number, to: number) => {
      const list = [...(latest.current.get(section) ?? [])]
      const [item] = list.splice(from, 1)
      if (!item) return
      list.splice(to, 0, item)
      commit(section, list)
    },
    [commit],
  )

  const replace = useCallback(
    (section: number, questionId: number, next: BuilderQuestion) => {
      const list = latest.current.get(section) ?? []
      commit(
        section,
        list.map((q) => (q.id === questionId ? next : q)),
        { refetch: true },
      )
    },
    [commit],
  )

  const clearSection = useCallback(
    (section: number) => commit(section, []),
    [commit],
  )

  const saveState: SaveState = failed
    ? 'error'
    : saving > 0
      ? 'saving'
      : pending.size > 0
        ? 'pending'
        : lastSavedAt > 0
          ? 'saved'
          : 'idle'

  return {
    draft,
    sections,
    active,
    setActive,
    idsInExam,
    capacityOf,
    add,
    appendMany,
    remove,
    move,
    replace,
    clearSection,
    saveState,
    /** Nothing is waiting to be written. Publishing needs this. */
    settled: pending.size === 0 && saving === 0,
  }
}

export type Builder = ReturnType<typeof useBuilder>

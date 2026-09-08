import { useEffect, useState } from 'react'
import { useBlocker, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { normalizeError } from '@/lib/errors'
import type { Book } from '@/features/books'
import type { PageResult } from '@/features/import/hooks/use-segmentation'
import { cropKey, useEnqueue, useSaveCrops } from '@/features/questions'

// Crops stay in memory until the operator SENDS them — only selected crops are
// persisted (as rows + storage objects) right before queueing, so the bank
// never fills with drafts nobody asked for. That is also why leaving the page
// needs a yes: crops persist only when sent, and leaving with unsent results
// discards them (recoverable by re-running the range, but usually accidental).
export function useCropQueue(input: {
  book: Book | null
  results: PageResult[]
  running: boolean
}) {
  const { book, results, running } = input
  const saveCrops = useSaveCrops()
  const enqueue = useEnqueue()
  const navigate = useNavigate()
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [sendConfirmOpen, setSendConfirmOpen] = useState(false)
  /** Crops already written and queued. They stop arming the unsaved-work guard. */
  const [sentKeys, setSentKeys] = useState<Set<string>>(new Set())

  const allCrops = results.flatMap((page) => page.crops)
  // What is actually at risk: crops that were never sent.
  const hasUnsentCrops = allCrops.some((c) => !sentKeys.has(cropKey(c)))
  const dirty = running || saveCrops.isPending || hasUnsentCrops
  const blocker = useBlocker(dirty)

  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  const eligibleKeys = new Set(
    book
      ? allCrops.map((c) => cropKey(c)).filter((key) => !sentKeys.has(key))
      : [],
  )
  const selectedCrops = allCrops.filter(
    (c) => selectedKeys.has(cropKey(c)) && eligibleKeys.has(cropKey(c)),
  )
  // Rough per-lane cost constants (documented estimates, not billing). The
  // scheme lane is a range, not a number: a `rule` crop whose DSL render fails
  // escalates to image generation, so $0.03 is its floor and $0.18 its ceiling.
  const laneCounts = { none: 0, rule: 0, colored: 0 }
  for (const c of selectedCrops) laneCounts[c.figureKind]++
  const costBase = laneCounts.none * 0.006 + laneCounts.colored * 0.16
  const costLow = costBase + laneCounts.rule * 0.03
  const costHigh = costBase + laneCounts.rule * 0.18

  function toggleSelected(key: string) {
    setSelectedKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function sendToQueue() {
    setSendConfirmOpen(false)
    if (!book) return
    const selectedResults = results
      .map((page) => ({
        ...page,
        crops: page.crops.filter((c) => selectedKeys.has(cropKey(c))),
      }))
      .filter((page) => page.crops.length > 0)
    setSelectedKeys(new Set())
    // Persist ONLY what is being sent, then queue exactly those rows.
    //
    // There is no "structure in this tab" any more. Draining questions belongs
    // to the worker: it batches them at half price, is not bounded by an Edge
    // Function's wall clock, and does not stop when the tab closes. What this
    // page owes the operator is the crops and a place in the queue.
    saveCrops.mutate(
      { book, results: selectedResults },
      {
        onSuccess: (res) => {
          if (!res.saved.length) return
          // Sent crops stop arming the unsaved-work guard: they are rows now,
          // and leaving the page no longer loses them.
          setSentKeys((prev) => {
            const next = new Set(prev)
            for (const entry of res.saved) next.add(cropKey(entry.crop))
            return next
          })
          void enqueue
            .mutateAsync(res.saved.map((e) => e.row.id))
            .then(() =>
              toast.info(`${res.saved.length} sual növbəyə əlavə edildi`, {
                action: {
                  label: 'Suallara keç',
                  onClick: () => navigate('/questions'),
                },
              }),
            )
            .catch(() => undefined)
        },
        onError: (error) => toast.error(normalizeError(error).message),
      },
    )
  }

  return {
    selectedKeys,
    setSelectedKeys,
    sendConfirmOpen,
    setSendConfirmOpen,
    eligibleKeys,
    selectedCrops,
    laneCounts,
    costLow,
    costHigh,
    toggleSelected,
    sendToQueue,
    blocker,
    /** A new document has no selection. Sent keys are kept: they are rows. */
    reset: () => setSelectedKeys(new Set()),
  }
}

import { useCallback, useMemo, useState } from 'react'
import type { FigureDoc, GeometryFig } from '@/core/figures/figspec'
import {
  addAngle,
  addLine,
  addPoint,
  movePoint,
  removeAngle,
  removeLine,
  removePoint,
  updateAngle,
  updateLine,
  updatePoint,
} from '@/core/figures/geometry-edit'
import type { CanvasMode, CanvasSelection } from '@/features/questions/components/figure-editor/geometry-canvas'

/**
 * The editing session for one geometry figure.
 *
 * History is a stack of whole specs rather than a list of inverse operations.
 * The specs are small, the operations are pure, and an undo that replays
 * inverses is a second implementation of every edit — the place where an editor
 * usually starts corrupting the thing it is editing.
 *
 * The document is kept whole and only the one geometry item is swapped, so a
 * figure that sits beside another kind does not lose its neighbour on save.
 */
export function useFigureEditor(doc: FigureDoc | null, itemIndex: number) {
  const original = useMemo(() => {
    const item = doc?.items[itemIndex]
    return item && item.kind === 'geometry' ? item : null
  }, [doc, itemIndex])

  const [history, setHistory] = useState<GeometryFig[]>(() => (original ? [original] : []))
  const [selection, setSelection] = useState<CanvasSelection | null>(null)
  const [mode, setMode] = useState<CanvasMode>('select')
  const [pending, setPending] = useState<string[]>([])

  const fig = history[history.length - 1] ?? null
  const isDirty = history.length > 1

  const push = useCallback((next: GeometryFig) => {
    setHistory((h) => [...h, next])
  }, [])

  /**
   * A drag is one undo step, not one per pointer event.
   *
   * Without this a reviewer nudging a point ten pixels has to press undo forty
   * times to get back, which in practice means they never undo and instead
   * cancel the whole session.
   */
  const replace = useCallback((next: GeometryFig) => {
    setHistory((h) => (h.length > 1 ? [...h.slice(0, -1), next] : [...h, next]))
  }, [])

  const [dragging, setDragging] = useState(false)

  const handleMovePoint = useCallback(
    (id: string, x: number, y: number) => {
      if (!fig) return
      const next = movePoint(fig, id, x, y)
      if (dragging) replace(next)
      else {
        setDragging(true)
        push(next)
      }
    },
    [fig, dragging, push, replace],
  )

  const endDrag = useCallback(() => setDragging(false), [])

  const undo = useCallback(() => {
    setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h))
    setSelection(null)
  }, [])

  const reset = useCallback(() => {
    setHistory((h) => (h.length ? [h[0]!] : h))
    setSelection(null)
    setPending([])
    setMode('select')
  }, [])

  /** Picking endpoints for a new edge, or the three points of a new angle. */
  const pickPoint = useCallback(
    (id: string) => {
      if (!fig) return
      const wanted = mode === 'line' ? 2 : 3
      // Picking the same point twice is a slip, not an instruction: an edge
      // needs two distinct ends and an angle three.
      if (pending.includes(id)) return
      const next = [...pending, id]
      if (next.length < wanted) {
        setPending(next)
        return
      }
      if (mode === 'line') push(addLine(fig, next[0]!, next[1]!))
      // The MIDDLE pick is the vertex, which matches how the spec stores it and
      // how a person says it: "the angle at B, between A and C".
      else push(addAngle(fig, [next[0]!, next[1]!, next[2]!] as [string, string, string]))
      setPending([])
      setMode('select')
    },
    [fig, mode, pending, push],
  )

  const startMode = useCallback((next: CanvasMode) => {
    setMode(next)
    setPending([])
    setSelection(null)
  }, [])

  const api = useMemo(
    () => ({
      addPointAt: (x: number, y: number) => fig && push(addPoint(fig, x, y)),
      updatePoint: (id: string, patch: Parameters<typeof updatePoint>[2]) =>
        fig && push(updatePoint(fig, id, patch)),
      removePoint: (id: string) => {
        if (!fig) return
        push(removePoint(fig, id))
        setSelection(null)
      },
      updateLine: (index: number, patch: Parameters<typeof updateLine>[2]) =>
        fig && push(updateLine(fig, index, patch)),
      removeLine: (index: number) => {
        if (!fig) return
        push(removeLine(fig, index))
        setSelection(null)
      },
      updateAngle: (index: number, patch: Parameters<typeof updateAngle>[2]) =>
        fig && push(updateAngle(fig, index, patch)),
      removeAngle: (index: number) => {
        if (!fig) return
        push(removeAngle(fig, index))
        setSelection(null)
      },
    }),
    [fig, push],
  )

  /** The whole document with the edited item swapped back in. */
  const toDoc = useCallback((): FigureDoc | null => {
    if (!doc || !fig) return null
    return { ...doc, items: doc.items.map((item, i) => (i === itemIndex ? fig : item)) }
  }, [doc, fig, itemIndex])

  return {
    fig,
    isDirty,
    canUndo: history.length > 1,
    selection,
    setSelection,
    mode,
    startMode,
    pending,
    pickPoint,
    handleMovePoint,
    endDrag,
    undo,
    reset,
    toDoc,
    ...api,
  }
}

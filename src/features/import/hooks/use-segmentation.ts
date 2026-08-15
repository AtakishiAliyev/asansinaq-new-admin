import { useCallback, useEffect, useRef, useState } from 'react'
import { renderCrops } from '@/core/segment/crop'
import { segmentPage } from '@/core/segment/segmenter'
import type { Crop } from '@/core/segment/types'
import { domCanvas, type PDFDocumentProxy } from '@/features/import/lib/pdf'

export interface PageResult {
  pageNumber: number
  isScan: boolean
  testNo?: number
  notes: string[]
  crops: Crop[]
}

interface SegmentationState {
  status: 'idle' | 'running' | 'done'
  current: number // pages processed so far
  total: number
  results: PageResult[]
}

const IDLE: SegmentationState = {
  status: 'idle',
  current: 0,
  total: 0,
  results: [],
}

// Pages run sequentially — each render is heavy, and the awaits between pages
// keep the UI responsive enough for an internal tool. A cancel ref (not state)
// stops the loop when the operator restarts or leaves.
export function useSegmentation() {
  const [state, setState] = useState<SegmentationState>(IDLE)
  const runId = useRef(0)

  // Leaving the page must stop the render loop at its next page boundary —
  // otherwise a full-page scale-3 render grinds on in the background.
  useEffect(
    () => () => {
      runId.current += 1
    },
    [],
  )

  // Returns the results of the pages that actually completed, so the caller
  // can record the processing trail even for a superseded run.
  const run = useCallback(async (doc: PDFDocumentProxy, pages: number[]) => {
    const id = ++runId.current
    setState({
      status: 'running',
      current: 0,
      total: pages.length,
      results: [],
    })

    const results: PageResult[] = []
    for (const pageNumber of pages) {
      if (runId.current !== id) return results // superseded by a newer run
      const page = await doc.getPage(pageNumber)
      const seg = await segmentPage(page)
      let crops: Crop[] = []
      let notes = seg.notes
      if (!seg.isScan && seg.bands.length > 0) {
        const rendered = await renderCrops(page, seg.bands, domCanvas)
        crops = rendered.crops
        notes = [...seg.notes, ...rendered.notes]
      }
      results.push({
        pageNumber,
        isScan: seg.isScan,
        testNo: seg.testNo,
        notes,
        crops,
      })
      if (runId.current !== id) return results
      setState({
        status: 'running',
        current: results.length,
        total: pages.length,
        results: [...results],
      })
    }
    if (runId.current !== id) return results
    setState({
      status: 'done',
      current: pages.length,
      total: pages.length,
      results,
    })
    return results
  }, [])

  const reset = useCallback(() => {
    runId.current++
    setState(IDLE)
  }, [])

  return { ...state, run, reset }
}

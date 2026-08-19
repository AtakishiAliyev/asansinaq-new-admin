import { useCallback, useEffect, useRef, useState } from 'react'
import { renderCrops } from '@/core/segment/crop'
import { scanPageSeg } from '@/core/segment/scan'
import { segmentPage } from '@/core/segment/segmenter'
import type { Crop, PageSeg } from '@/core/segment/types'
import { isBudgetExhausted, opDetectQuestions } from '@/features/questions'
import {
  domCanvas,
  renderPageJpeg,
  type PDFDocumentProxy,
} from '@/features/import/lib/pdf'

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

type PDFPage = Awaited<ReturnType<PDFDocumentProxy['getPage']>>

// Everything up to (and including) the network detection for one page. Never
// rejects: failures come back as a result value, so a lookahead promise can
// never become an unhandled rejection.
type Analyzed =
  | { pageNumber: number; page: PDFPage; seg: PageSeg; scanMode: boolean }
  | { pageNumber: number; failed: string }

async function analyzePage(
  doc: PDFDocumentProxy,
  pageNumber: number,
): Promise<Analyzed> {
  try {
    const page = await doc.getPage(pageNumber)
    let seg = await segmentPage(page)
    let scanMode = false
    // No text layer → the AI scan path takes over: one vision call finds the
    // question boxes, then the shared crop pipeline runs unchanged.
    if (seg.isScan) {
      scanMode = true
      try {
        const { base64, mime } = await renderPageJpeg(page)
        const detection = await opDetectQuestions({ image: base64, mime })
        seg = scanPageSeg(detection, page.pageNumber, seg.width, seg.height)
      } catch (error) {
        console.error('scan detection failed', pageNumber, error)
        seg = {
          ...seg,
          notes: [
            ...seg.notes,
            isBudgetExhausted()
              ? 'Günlük model büdcəsi bitdi — bu səhifə aşkarlanmadı'
              : 'AI aşkarlanması alınmadı — yenidən cəhd edin',
          ],
        }
      }
    }
    return { pageNumber, page, seg, scanMode }
  } catch (error) {
    console.error('page analysis failed', pageNumber, error)
    return { pageNumber, failed: 'Səhifə emalı alınmadı — yenidən cəhd edin' }
  }
}

// Lookahead-1 pipeline: while page N's crops render on the CPU, page N+1's
// analysis (including its multi-second Gemini wait) is already in flight —
// roughly halving wall-clock time on scan books. A cancel ref (not state)
// stops the loop when the operator restarts or leaves.
export function useSegmentation() {
  const [state, setState] = useState<SegmentationState>(IDLE)
  const runId = useRef(0)

  // Leaving the page must stop the loop at its next page boundary.
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
    // The range parser refuses an empty selection, so page 0 is always there;
    // the lookahead only ever reads a page it just bounds-checked.
    let pending = analyzePage(doc, pages[0]!)
    for (let i = 0; i < pages.length; i++) {
      const analyzed = await pending
      if (runId.current !== id) return results // superseded by a newer run
      if (i + 1 < pages.length) pending = analyzePage(doc, pages[i + 1]!)

      if ('failed' in analyzed) {
        results.push({
          pageNumber: analyzed.pageNumber,
          isScan: false,
          notes: [analyzed.failed],
          crops: [],
        })
      } else {
        const { page, seg, scanMode } = analyzed
        let crops: Crop[] = []
        let notes = seg.notes
        try {
          if (seg.bands.length > 0) {
            const rendered = await renderCrops(page, seg.bands, domCanvas, {
              scanMode,
            })
            crops = rendered.crops
            notes = [...seg.notes, ...rendered.notes]
          }
        } catch (error) {
          console.error('crop render failed', analyzed.pageNumber, error)
          notes = [...notes, 'Sual kəsimi alınmadı — yenidən cəhd edin']
        }
        // Release this page's decoded bitmaps — the loop never revisits it.
        try {
          page.cleanup()
        } catch {
          // a concurrent preview render defers cleanup; nothing to do
        }
        results.push({
          pageNumber: analyzed.pageNumber,
          isScan: seg.isScan,
          testNo: seg.testNo,
          notes,
          crops,
        })
      }

      if (runId.current !== id) return results
      setState({
        status: 'running',
        current: results.length,
        total: pages.length,
        results: [...results],
      })
      // Scan pages cost a model call each. Once the day's budget is spent,
      // stop: continuing would turn every remaining page into a detection
      // failure that has to be re-run tomorrow anyway.
      if (isBudgetExhausted()) break
    }
    if (runId.current !== id) return results
    setState({
      status: 'done',
      current: results.length,
      total: pages.length,
      results,
    })
    return results
  }, [])

  const reset = useCallback(() => {
    runId.current++
    setState(IDLE)
  }, [])

  // Operator-facing cancel: supersedes the loop at its next page boundary but
  // KEEPS the pages already finished — stopping late must not discard work.
  const stop = useCallback(() => {
    runId.current++
    setState((current) =>
      current.status === 'running' ? { ...current, status: 'done' } : current,
    )
  }, [])

  return { ...state, run, reset, stop }
}

import { z } from 'zod'
import type { Band, PageSeg } from '@/core/segment/types'

// Scan-mode segmentation, the AI half of the two-front-ends/one-contract
// design: a vision model returns per-question bounding boxes (normalized
// 0–1000), this module converts them into the same Band/PageSeg shape the
// text path emits. Everything downstream (ink refinement, cropping) is shared.
// Pure: the network call lives in the Edge Function, the rendering in the
// feature — this file only transforms data.

export const scanDetectionSchema = z.object({
  columns: z.number(),
  testNo: z.number().optional(),
  anchors: z.array(
    z.object({
      number: z.number(),
      box: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    }),
  ),
})

export type ScanDetection = z.infer<typeof scanDetectionSchema>

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v))

// Geometry over model claims: the detector's column labels are advisory —
// on 2-column pages each box is re-assigned by its own center. Boxes are
// clamped, degenerate ones dropped, repeated numbers deduplicated.
export function scanPageSeg(
  detection: ScanDetection,
  pageNumber: number,
  W: number,
  H: number,
): PageSeg {
  const notes: string[] = ['Skan rejimi: sual sərhədləri AI ilə tapılıb']
  const columns = detection.columns >= 2 ? 2 : 1
  const mid = W / 2

  const items = detection.anchors
    .map((a) => ({
      number: a.number,
      col: 0,
      yTop: clamp((a.box[0] / 1000) * H, 0, H),
      yBot: clamp((a.box[2] / 1000) * H, 0, H),
      xL: clamp((a.box[1] / 1000) * W, 0, W),
      xR: clamp((a.box[3] / 1000) * W, 0, W),
    }))
    .filter((a) => a.yBot > a.yTop && Number.isFinite(a.number))

  for (const it of items) {
    if (columns === 2) {
      it.col = (it.xL + it.xR) / 2 < mid ? 0 : 1
      // A box the model over-drew across both columns must not drag its whole
      // column's extents to page width — clamp it to its assigned half
      // (small tolerance for a slightly off-centre gutter).
      const tol = 0.02 * W
      if (it.col === 0) it.xR = Math.min(it.xR, mid + tol)
      else it.xL = Math.max(it.xL, mid - tol)
    }
  }

  const bands: Band[] = []
  for (const col of [0, 1]) {
    const colItems = items
      .filter((it) => it.col === col)
      .sort((p, q) => p.yTop - q.yTop)
    if (!colItems.length) continue
    // Set-based: a repeated number must be dropped even when the duplicates
    // are not adjacent in the y-sorted order.
    const seen = new Set<number>()
    const dedup = colItems.filter(
      (it) => !seen.has(it.number) && (seen.add(it.number), true),
    )

    const colLeft = Math.min(...dedup.map((it) => it.xL))
    const colRight = Math.max(...dedup.map((it) => it.xR))
    const contentTop = clamp(dedup[0].yTop - 10, 0, H)
    const contentBottom = clamp(dedup[dedup.length - 1].yBot + 10, 0, H)

    for (let i = 0; i < dedup.length; i++) {
      const cur = dedup[i]
      const top = i === 0 ? contentTop : (dedup[i - 1].yBot + cur.yTop) / 2
      const bottom =
        i === dedup.length - 1
          ? contentBottom
          : (cur.yBot + dedup[i + 1].yTop) / 2
      bands.push({
        number: cur.number,
        col,
        bbox: {
          x: Math.max(0, colLeft - 6),
          y: top,
          w: Math.min(W, colRight - colLeft + 12),
          h: bottom - top,
        },
        anchorYTop: cur.yTop,
        textLayer: '', // scans have no text layer
      })
    }
  }

  bands.sort((p, q) => p.col - q.col || p.bbox.y - q.bbox.y)
  if (!bands.length) notes.push('AI bu səhifədə sual tapmadı')

  return {
    pageNumber,
    width: W,
    height: H,
    testNo: detection.testNo,
    bands,
    notes,
    isScan: true,
  }
}

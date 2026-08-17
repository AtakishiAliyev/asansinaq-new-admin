import type { PDFPageProxy } from 'pdfjs-dist'
import type { Band, Crop, CropResult, FigureKind } from '@/core/segment/types'

// Render the page once, refine question boundaries against the real pixel ink
// profile, slice one PNG per question. Figures are vector paths invisible to
// the text layer, so midpoint-of-text cuts can slice a drawing; the refiner
// moves each cut into the actual whitespace gap above the next question's ink.
//
// Runtime-agnostic: the caller injects a canvas factory (DOM canvas in the
// browser, @napi-rs/canvas in Node evals). No DOM access here.
//
// Node harness note: scanned books need pdf.js's wasm decoders (JBIG2/JPX).
// Pass getDocument({ wasmUrl }) as a PLAIN filesystem path with a trailing
// slash (e.g. <repo>/node_modules/pdfjs-dist/wasm/), NOT a file:// URL —
// Node's binary loader treats the string as a literal path and a URL silently
// downgrades to the JS fallback, re-creating the blank-text-layer bug.

const INK_LUMINANCE = 150 // darker counts as ink; pale watermarks sit ~200+

export interface CanvasLike {
  width: number
  height: number
  getContext(kind: '2d', opts?: unknown): CanvasRenderingContext2D | null
  toDataURL(type?: string, quality?: number): string
}
export type MakeCanvas = (w: number, h: number) => CanvasLike

// Scans have grey paper and JPEG noise, so a fixed cutoff misreads them.
// Estimate the paper tone from the brightest histogram peak, cut ~30% below.
export function adaptiveInkThreshold(img: ImageData): number {
  const hist = new Uint32Array(256)
  const { data } = img
  for (let i = 0; i < data.length; i += 4 * 8) {
    const lum =
      (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) | 0
    hist[lum]++
  }
  let bgPeak = 255
  let peakCount = 0
  for (let l = 128; l < 256; l++) {
    if (hist[l] > peakCount) {
      peakCount = hist[l]
      bgPeak = l
    }
  }
  return Math.max(120, Math.min(200, Math.round(bgPeak * 0.7)))
}

// Saturated DARK pixels = colored figure ink; black text has near-zero
// chroma, and pale watermark tints (which are saturated but light, lum
// ~150-220) must not count — a watermark over a plain scheme would otherwise
// route the question to the expensive raster lane. Real figure inks (book
// red/blue/green/purple) all sit under ~110 luminance.
function coloredInkCount(
  img: ImageData,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): number {
  let count = 0
  const { data, width } = img
  for (let y = Math.max(0, y0); y < Math.min(img.height, y1); y += 2) {
    const rowOff = y * width
    for (let x = Math.max(0, x0); x < Math.min(width, x1); x += 2) {
      const i = (rowOff + x) * 4
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      if (
        0.299 * r + 0.587 * g + 0.114 * b < 135 &&
        Math.max(r, g, b) - Math.min(r, g, b) > 45
      ) {
        count++
      }
    }
  }
  return count
}

// ≥350 sampled colored pixels (stride 2 ⇒ ~1400 real) = a drawn figure, not a
// stray colored label or anti-aliasing.
const FIGURE_SAMPLE_THRESHOLD = 350

// B&W schemes (division layouts, tables) carry no color but DO contain long
// horizontal rules — something prose never has. ~18pt run = scheme signal.
function hasHorizontalRule(
  img: ImageData,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  inkLum: number,
  scale: number,
): boolean {
  const { data, width } = img
  const minRun = Math.round(18 * scale)
  const yEnd = Math.min(img.height, y1)
  const xEnd = Math.min(width, x1)
  for (let y = Math.max(0, y0); y < yEnd; y++) {
    let run = 0
    const rowOff = y * width
    for (let x = Math.max(0, x0); x < xEnd; x++) {
      const i = (rowOff + x) * 4
      if (
        0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] <
        inkLum
      ) {
        if (++run >= minRun) return true
      } else {
        run = 0
      }
    }
  }
  return false
}

export function classifyFigureRegion(
  img: ImageData,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  inkLum: number,
  scale: number,
): FigureKind {
  // The 350-sample threshold was calibrated at scale 3; the stride-2 sampling
  // grid is fixed in device pixels, so normalize by rendered area.
  const threshold = Math.round(FIGURE_SAMPLE_THRESHOLD * (scale / 3) ** 2)
  if (coloredInkCount(img, x0, x1, y0, y1) >= threshold) return 'colored'
  if (hasHorizontalRule(img, x0, x1, y0, y1, inkLum, scale)) return 'rule'
  return 'none'
}

function inkCountInRow(
  data: Uint8ClampedArray,
  imgWidth: number,
  y: number,
  x0: number,
  x1: number,
  inkLum: number,
): number {
  let count = 0
  const rowOff = y * imgWidth
  for (let x = x0; x < x1; x += 2) {
    const i = (rowOff + x) * 4
    if (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] < inkLum)
      count++
  }
  return count
}

// Pure: returns refined copies, never mutates the caller's bands.
function refineBandBounds(
  input: Band[],
  img: ImageData,
  scale: number,
  inkLum: number,
): { bands: Band[]; notes: string[] } {
  const bands = input.map((b) => ({ ...b, bbox: { ...b.bbox } }))
  const notes: string[] = []
  const byCol = new Map<number, Band[]>()
  for (const b of bands) {
    const list = byCol.get(b.col) ?? []
    list.push(b)
    byCol.set(b.col, list)
  }

  for (const colBands of byCol.values()) {
    colBands.sort((p, q) => p.bbox.y - q.bbox.y)
    for (let i = 0; i < colBands.length - 1; i++) {
      const a = colBands[i]
      const b = colBands[i + 1]
      const x0 = Math.max(0, Math.floor(Math.min(a.bbox.x, b.bbox.x) * scale))
      const x1 = Math.min(
        img.width,
        Math.ceil(Math.max(a.bbox.x + a.bbox.w, b.bbox.x + b.bbox.w) * scale),
      )
      if (x1 - x0 < 8) continue

      // Scan upward from b's anchor, through any ink block touching it (a
      // figure drawn beside its own number), to the first clean run of rows.
      const winTop = Math.floor((a.anchorYTop + 6) * scale)
      const anchorB = Math.max(winTop + 1, Math.floor(b.anchorYTop * scale))
      const cleanNeeded = Math.max(6, Math.round(2.5 * scale))
      const tol = Math.max(2, Math.round((x1 - x0) * 0.004))

      let y = anchorB - 1
      let clean = 0
      let boundaryPx = -1
      while (y > winTop) {
        if (inkCountInRow(img.data, img.width, y, x0, x1, inkLum) <= tol) {
          clean++
          if (clean >= cleanNeeded) {
            let top = y
            while (
              top - 1 > winTop &&
              inkCountInRow(img.data, img.width, top - 1, x0, x1, inkLum) <= tol
            ) {
              top--
            }
            boundaryPx = Math.round((top + (y + clean - 1)) / 2)
            break
          }
        } else {
          clean = 0
        }
        y--
      }

      if (boundaryPx < 0) {
        notes.push(
          `Sütun ${a.col + 1}: №${a.number}–№${b.number} arasında təmiz boşluq tapılmadı — orta xətt saxlanıldı`,
        )
        continue
      }
      const boundaryPt = boundaryPx / scale
      a.bbox.h = boundaryPt - a.bbox.y
      b.bbox.h = b.bbox.y + b.bbox.h - boundaryPt
      b.bbox.y = boundaryPt
    }

    // Trim each band to its real ink extents (+padding); never above the anchor.
    for (const band of colBands) {
      const x0 = Math.max(0, Math.floor(band.bbox.x * scale))
      const x1 = Math.min(
        img.width,
        Math.ceil((band.bbox.x + band.bbox.w) * scale),
      )
      let top = Math.max(0, Math.floor(band.bbox.y * scale))
      let bottom = Math.min(
        img.height - 1,
        Math.ceil((band.bbox.y + band.bbox.h) * scale),
      )
      const tol = Math.max(2, Math.round((x1 - x0) * 0.004))
      while (
        top < bottom &&
        inkCountInRow(img.data, img.width, top, x0, x1, inkLum) <= tol
      ) {
        top++
      }
      while (
        bottom > top &&
        inkCountInRow(img.data, img.width, bottom, x0, x1, inkLum) <= tol
      ) {
        bottom--
      }
      const padPt = 8
      const newTop = Math.min(top / scale, band.anchorYTop) - padPt
      const newBottom = bottom / scale + padPt
      const clampedTop = Math.max(band.bbox.y, newTop)
      const clampedBottom = Math.min(band.bbox.y + band.bbox.h, newBottom)
      if (clampedBottom - clampedTop > 12) {
        band.bbox.y = clampedTop
        band.bbox.h = clampedBottom - clampedTop
      }
    }
  }
  return { bands, notes }
}

// Some scanning tools write the MediaBox in PIXELS rather than points; a
// fixed scale then produces a 35-78M px canvas that silently blanks on iOS
// and allocates hundreds of MB. Cap the rendered area instead.
const MAX_CANVAS_AREA_PX = 16_000_000

export async function renderCrops(
  page: PDFPageProxy,
  bands: Band[],
  makeCanvas: MakeCanvas,
  opts: { scale?: number; scanMode?: boolean } = {},
): Promise<CropResult> {
  const base = page.getViewport({ scale: 1 })
  const scale = Math.min(
    opts.scale ?? 3,
    Math.sqrt(MAX_CANVAS_AREA_PX / (base.width * base.height)),
  )
  const viewport = page.getViewport({ scale })
  const canvas = makeCanvas(
    Math.ceil(viewport.width),
    Math.ceil(viewport.height),
  )
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('canvas 2d context alınmadı')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  // pdf.js v6 wants the canvas itself; pass the context for the injected
  // non-DOM canvases (Node), whose object identity pdf.js can't introspect.
  await page.render({ canvas: null, canvasContext: ctx, viewport }).promise

  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const inkLum = opts.scanMode ? adaptiveInkThreshold(img) : INK_LUMINANCE
  const { bands: refined, notes } = refineBandBounds(bands, img, scale, inkLum)

  const crops: Crop[] = []
  for (const b of refined) {
    const sx = Math.max(0, Math.floor(b.bbox.x * scale))
    const sy = Math.max(0, Math.floor(b.bbox.y * scale))
    const sw = Math.min(canvas.width - sx, Math.ceil(b.bbox.w * scale))
    const sh = Math.min(canvas.height - sy, Math.ceil(b.bbox.h * scale))
    if (sw <= 0 || sh <= 0) continue

    const sub = makeCanvas(sw, sh)
    const sctx = sub.getContext('2d')
    if (!sctx) throw new Error('canvas 2d context alınmadı')
    sctx.fillStyle = '#ffffff'
    sctx.fillRect(0, 0, sw, sh)
    sctx.drawImage(
      canvas as unknown as CanvasImageSource,
      sx,
      sy,
      sw,
      sh,
      0,
      0,
      sw,
      sh,
    )

    crops.push({
      number: b.number,
      col: b.col,
      pageNumber: page.pageNumber,
      // Scan content is photographic — PNG balloons 4-5x there, JPEG q0.9 is
      // visually identical. Vector-rendered text pages stay crisp PNG.
      dataUrl: opts.scanMode
        ? sub.toDataURL('image/jpeg', 0.9)
        : sub.toDataURL('image/png'),
      figureKind: classifyFigureRegion(
        img,
        sx,
        sx + sw,
        sy,
        sy + sh,
        inkLum,
        scale,
      ),
      textLayer: b.textLayer,
    })
  }
  return { crops, notes }
}

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

// Every pixel loop below indexes `data` off the image's own width and height,
// so the reads are in bounds by construction and `!` stands in for a check
// that could never fail — a real guard would run 16M times to do nothing.
//
// Scans have grey paper and JPEG noise, so a fixed cutoff misreads them.
// Estimate the paper tone from the brightest histogram peak, cut ~30% below.
export function adaptiveInkThreshold(img: ImageData): number {
  const hist = new Uint32Array(256)
  const { data } = img
  for (let i = 0; i < data.length; i += 4 * 8) {
    const lum =
      (0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!) | 0
    hist[lum]!++
  }
  let bgPeak = 255
  let peakCount = 0
  for (let l = 128; l < 256; l++) {
    if (hist[l]! > peakCount) {
      peakCount = hist[l]!
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
      const r = data[i]!
      const g = data[i + 1]!
      const b = data[i + 2]!
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
        0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]! <
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

// Plane geometry — the largest figure class in these books — has neither
// colour nor a long horizontal rule, so the two signals above miss it and the
// question goes to the plain lane, where no figure is drawn and none is
// compared. What a drawing DOES leave is a tall block of rows that hold ink
// but almost none of it: the inside of a triangle, a circle or a coordinate
// grid is empty except for the lines crossing it. Text cannot look like that
// — a text row is a dense run of glyphs and the space between two lines holds
// no ink at all, so any sparse run is broken within one line height. That
// difference is what this measures, rather than "is there a long line", which
// a tall `cases` brace would also answer yes to.
const SPARSE_ROW_INK_RATIO = 0.05
const SPARSE_BLOCK_PT = 40

function hasSparseInkBlock(
  img: ImageData,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  inkLum: number,
  scale: number,
): boolean {
  const { data, width } = img
  const xStart = Math.max(0, x0)
  const xEnd = Math.min(width, x1)
  const maxSparse = Math.max(1, (xEnd - xStart) * SPARSE_ROW_INK_RATIO)
  const minBlock = Math.round(SPARSE_BLOCK_PT * scale)
  let block = 0
  for (let y = Math.max(0, y0); y < Math.min(img.height, y1); y++) {
    // Every pixel, not every other one: a hairline edge is one pixel wide, and
    // sampling by parity would find or miss the same triangle depending on
    // where it happens to sit.
    let count = 0
    const rowOff = y * width
    for (let x = xStart; x < xEnd; x++) {
      const i = (rowOff + x) * 4
      if (
        0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]! <
        inkLum
      ) {
        count++
      }
    }
    if (count > 0 && count <= maxSparse) {
      if (++block >= minBlock) return true
    } else {
      block = 0
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
  if (hasSparseInkBlock(img, x0, x1, y0, y1, inkLum, scale)) return 'rule'
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
    if (0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]! < inkLum)
      count++
  }
  return count
}

/**
 * How much wider a chosen boundary gap must be than the widest gap left inside
 * a question.
 *
 * It started at 1.5, taken from one page where the gaps between questions ran
 * 130-250px against at most 20 inside one. That page was not representative:
 * across 36 sampled pages of the three image-only books, every refusal landed
 * between 1.00 and 1.48 — the chosen gaps were always the widest available,
 * just not by half again.
 *
 * And refusing is not neutral. The fallback is the detector's own boxes, which
 * are evenly spaced slabs rather than measurements: on the page that started
 * this, it answered 0-150, 150-350, 350-550 for ink at 62-179, 431-535 and
 * 764-903. So the comparison is not "a marginal split against no split", it is
 * "a marginal split against a guess we already know to be wrong".
 *
 * Measured over the same 36 pages, clean pages by book: at 1.5, 2 and 3 of 12;
 * at 1.25, 6 and 6; at 1.15, 7 and 7; at 1.05, 9 and 9. The third book, whose
 * ink always separated cleanly, stayed at 12 of 12 throughout — lowering this
 * cannot disturb a page that already passed.
 *
 * What still guards the degenerate case is the run count: ink that yields fewer
 * blocks than there are questions refuses regardless, and identical gaps score
 * exactly 1.00 and refuse here.
 */
const SPLIT_MARGIN = 1.05

/** Ink row-runs inside one column, as pixel rows. */
function inkRuns(
  img: ImageData,
  x0: number,
  x1: number,
  inkLum: number,
  minRun: number,
): { top: number; bottom: number }[] {
  const tol = Math.max(2, Math.round((x1 - x0) * 0.004))
  const runs: { top: number; bottom: number }[] = []
  let start = -1
  for (let y = 0; y <= img.height; y++) {
    const on =
      y < img.height &&
      inkCountInRow(img.data, img.width, y, x0, x1, inkLum) > tol
    if (on && start < 0) start = y
    if (!on && start >= 0) {
      if (y - start >= minRun) runs.push({ top: start, bottom: y - 1 })
      start = -1
    }
  }
  return runs
}

/**
 * Scan-page question bounds, measured from the page instead of asked for.
 *
 * The detector's y coordinates are not measurements. On a reviewed page it
 * answered 0-150, 150-350, 350-550 for the left column while the ink sat at
 * 62-179, 431-535 and 764-903 of the same 1000-unit grid — evenly spaced slabs,
 * wrong by as much as 410, and three of six crops held the wrong part of the
 * page. The ink refiner could not rescue them: it searches upward from an
 * anchor for whitespace, so an anchor in the wrong third of the page finds the
 * wrong gap.
 *
 * What the model IS reliable about is WHAT — how many questions a column holds,
 * their numbers and their order. So the numbering comes from the detection and
 * the geometry comes from the pixels, the same division the option and figure
 * localizers already make.
 *
 * The split needs no threshold: a column holding N questions is cut at the N-1
 * WIDEST gaps between ink runs. On that page the gaps between questions ran
 * 130-250 units against at most 20 inside one, so the choice is not close — and
 * where it IS close, this refuses and leaves the detection's boxes alone. A
 * confidently wrong split is worse than a crude one, because a question cut in
 * half reads downstream exactly like a question the book never printed.
 */
export function regroupScanBands(
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
    const wanted = colBands.length
    if (wanted < 2) continue

    const x0 = Math.max(0, Math.floor(Math.min(...colBands.map((b) => b.bbox.x)) * scale))
    const x1 = Math.min(
      img.width,
      Math.ceil(Math.max(...colBands.map((b) => b.bbox.x + b.bbox.w)) * scale),
    )
    if (x1 - x0 < 8) continue

    const runs = inkRuns(img, x0, x1, inkLum, Math.max(2, Math.round(scale)))
    if (runs.length < wanted) {
      notes.push(
        `Sütun ${colBands[0]!.col}: mürəkkəb ${runs.length} bloka ayrıldı, ${wanted} sual gözlənilirdi — AI qutuları saxlanıldı`,
      )
      continue
    }

    const gaps = runs
      .slice(1)
      .map((r, i) => ({ at: i + 1, size: r.top - runs[i]!.bottom - 1 }))
      .sort((a, b) => b.size - a.size)
    const chosen = gaps.slice(0, wanted - 1)
    const rest = gaps.slice(wanted - 1)
    const smallestChosen = Math.min(...chosen.map((g) => g.size))
    const largestRest = rest.length ? Math.max(...rest.map((g) => g.size)) : 0
    // Clearly larger, not merely larger: a split decided by a few pixels is a
    // guess wearing a measurement's clothes.
    if (smallestChosen < largestRest * SPLIT_MARGIN) {
      notes.push(
        `Sütun ${colBands[0]!.col}: sual sərhədləri mürəkkəbdən aydın seçilmir ` +
          `(${smallestChosen}px / ${largestRest}px = ${(smallestChosen / Math.max(1, largestRest)).toFixed(2)}) — AI qutuları saxlanıldı`,
      )
      continue
    }

    const cuts = new Set(chosen.map((g) => g.at))
    const groups: { top: number; bottom: number }[] = []
    let current = { top: runs[0]!.top, bottom: runs[0]!.bottom }
    for (let i = 1; i < runs.length; i++) {
      if (cuts.has(i)) {
        groups.push(current)
        current = { top: runs[i]!.top, bottom: runs[i]!.bottom }
      } else {
        current.bottom = runs[i]!.bottom
      }
    }
    groups.push(current)

    for (const [i, band] of colBands.entries()) {
      const g = groups[i]
      if (!g) continue
      band.bbox.y = g.top / scale
      band.bbox.h = (g.bottom - g.top + 1) / scale
      band.anchorYTop = g.top / scale
    }
  }

  return { bands, notes }
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
      if (!a || !b) continue
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
  // On a scan the boxes came from a model that did not measure them, so the
  // pixels get to say where the questions are before anything is cut.
  const grouped = opts.scanMode
    ? regroupScanBands(bands, img, scale, inkLum)
    : { bands, notes: [] as string[] }
  const { bands: refined, notes: refineNotes } = refineBandBounds(
    grouped.bands,
    img,
    scale,
    inkLum,
  )
  const notes = [...grouped.notes, ...refineNotes]

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

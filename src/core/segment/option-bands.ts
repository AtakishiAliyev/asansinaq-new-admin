// Where the picture options actually are.
//
// The model says WHICH options are pictures and in what order. It is measurably
// bad at saying where: on a live IQ page its five boxes spanned 355–680 of the
// 0–1000 grid while the option rows were at 552–999, so the first cut came back
// as blank paper — 0% ink, 0% colour — and the question lost an option that was
// plainly there. Two prompt iterations moved the boxes without moving them to
// the right place.
//
// The rows are trivially measurable, though: options are the bottom-most
// content on a question crop, they carry ink or colour, and they sit in a
// regular column with white paper between them. So the model's boxes become a
// hint about the search region and the pixels become the authority on position.
//
// It refuses rather than guesses. A crop where the bands cannot be matched to
// the option count is flagged for a human, because a confidently wrong box
// silently deletes an option and nothing downstream can tell that apart from an
// option the book never printed.
import { luminance, saturation, type Pixels } from '@/core/segment/image-clean'

/** `[ymin, xmin, ymax, xmax]` on a 0-1000 grid — the shape the pipeline uses. */
export type Box = [number, number, number, number]

export interface Band {
  /** Inclusive pixel rows. */
  top: number
  bottom: number
}

export interface LocalizeOptions {
  /** A row needs this share of its width in content to count as occupied. */
  rowThreshold?: number
  /** Bands thinner than this share of the crop height are noise. */
  minBandHeight?: number
  /** Gaps smaller than this share of the crop height do not split a band. */
  maxInnerGap?: number
  /** Padding added around a snapped band, as a share of the crop height. */
  pad?: number
  /** White wider than this share of the crop separates two options in a row. */
  maxGutter?: number
}

const DEFAULTS: Required<LocalizeOptions> = {
  rowThreshold: 0.005,
  minBandHeight: 0.015,
  maxInnerGap: 0.012,
  pad: 0.006,
  maxGutter: 0.045,
}

export type LocalizeResult =
  | { ok: true; boxes: Box[]; bands: Band[] }
  | { ok: false; reason: string; bands: Band[] }

const isContent = (d: Uint8ClampedArray, i: number): boolean => {
  const lum = luminance(d, i)
  // Ink OR deliberate colour. Colour has to count on its own: a row of pale
  // yellow circles is not dark, and thresholding on darkness alone loses it.
  return lum < 200 || (saturation(d, i) >= 0.28 && lum < 245)
}

/** Rows carrying content, merged into bands. */
export function contentBands(pix: Pixels, options: LocalizeOptions = {}): Band[] {
  const { rowThreshold, minBandHeight, maxInnerGap } = { ...DEFAULTS, ...options }
  const minRun = Math.max(2, Math.round(minBandHeight * pix.height))
  const maxGap = Math.max(1, Math.round(maxInnerGap * pix.height))
  const need = Math.max(1, Math.round(rowThreshold * pix.width))

  const occupied: boolean[] = []
  for (let y = 0; y < pix.height; y++) {
    let hits = 0
    for (let x = 0; x < pix.width; x++) {
      if (isContent(pix.data, (y * pix.width + x) * 4)) hits++
      if (hits >= need) break
    }
    occupied.push(hits >= need)
  }

  const bands: Band[] = []
  let start = -1
  for (let y = 0; y <= pix.height; y++) {
    const on = occupied[y] === true
    if (on && start < 0) start = y
    if (!on && start >= 0) {
      const previous = bands[bands.length - 1]
      // A row of circles has ragged edges and can break for a pixel or two;
      // splitting there would report ten bands where there are five.
      if (previous && start - previous.bottom - 1 <= maxGap) previous.bottom = y - 1
      else bands.push({ top: start, bottom: y - 1 })
      start = -1
    }
  }
  return bands.filter((b) => b.bottom - b.top + 1 >= minRun)
}

/** Leftmost and rightmost content columns inside a band. */
function extentOf(pix: Pixels, band: Band): { left: number; right: number } | null {
  let left = pix.width
  let right = -1
  for (let y = band.top; y <= band.bottom; y++) {
    for (let x = 0; x < pix.width; x++) {
      if (!isContent(pix.data, (y * pix.width + x) * 4)) continue
      if (x < left) left = x
      if (x > right) right = x
    }
  }
  return right < left ? null : { left, right }
}

/**
 * Drop the "A)" labels from a band's cells.
 *
 * The label is its own cell once the row is split on gutters, and it must go or
 * every option row reports twice as many cells as it has options — which the
 * exact-count check then correctly refuses, on a page that is perfectly
 * readable.
 *
 * Narrowness is judged against the OTHER cells in the same band rather than
 * against an absolute width, so it works for a column (label, picture) and for
 * a grid (label, picture, label, picture, label, picture) without knowing which
 * it is looking at. When every cell is narrow — five thin options in a row —
 * the median is narrow too and nothing is dropped.
 */
function dropLabelCells(
  cells: { left: number; right: number }[],
): { left: number; right: number }[] {
  if (cells.length < 2) return cells
  const widths = cells.map((c) => c.right - c.left + 1).sort((a, b) => a - b)
  const median = widths[Math.floor(widths.length / 2)]!
  const kept = cells.filter((c) => c.right - c.left + 1 >= median * 0.4)
  // Never return nothing: if the rule would empty the band, it has misread the
  // layout and the raw cells are the safer answer.
  return kept.length ? kept : cells
}

/** Occupied column runs inside a band, split on white gutters. */
function cellsInBand(
  pix: Pixels,
  band: Band,
  left: number,
  right: number,
  maxGutter: number,
): { left: number; right: number }[] {
  const occupied: boolean[] = []
  for (let x = left; x <= right; x++) {
    let on = false
    for (let y = band.top; y <= band.bottom && !on; y++) {
      if (isContent(pix.data, (y * pix.width + x) * 4)) on = true
    }
    occupied.push(on)
  }
  const cells: { left: number; right: number }[] = []
  let start = -1
  for (let i = 0; i <= occupied.length; i++) {
    const on = occupied[i] === true
    if (on && start < 0) start = i
    if (!on && start >= 0) {
      const previous = cells[cells.length - 1]
      // Only a wide gutter separates two options. Narrow white inside a
      // pictogram — the hole in a ring, the gap between two shapes — must not
      // split one option into several.
      if (previous && left + start - previous.right - 1 <= maxGutter) previous.right = left + i - 1
      else cells.push({ left: left + start, right: left + i - 1 })
      start = -1
    }
  }
  return cells
}

/**
 * Snap the option boxes to the pixels.
 *
 * `hint` is the model's own boxes, used ONLY to decide where to start looking —
 * everything at or below the top of the highest hint, with generous slack —
 * because the model reliably knows the options come after the figure even when
 * it is wrong about the rows. Pass nothing to search the whole crop.
 *
 * Options are laid out either as a column (five rows) or as a grid (three
 * across, then two), so bands are split into cells and the cells are returned
 * in reading order. Getting this wrong in the tolerant direction is the whole
 * danger, so the count must come out exactly right or nothing is returned.
 */
export function localizeOptionBoxes(
  pix: Pixels,
  expected: number,
  hint?: Box[],
  options: LocalizeOptions = {},
): LocalizeResult {
  if (expected <= 0) return { ok: false, reason: 'no picture options to place', bands: [] }
  const { pad, maxGutter } = { ...DEFAULTS, ...options }

  // Generous slack: the model was 200 units too high on the case this was built
  // for, so a tight floor would exclude the very rows being looked for.
  const floor = hint?.length
    ? Math.max(0, Math.round(((Math.min(...hint.map((b) => b[0])) - 150) / 1000) * pix.height))
    : 0

  const all = contentBands(pix, options)
  const below = all.filter((b) => b.bottom >= floor)
  if (!below.length) {
    return { ok: false, reason: 'no content found below the figure', bands: [] }
  }

  const gutterPx = Math.max(2, Math.round(maxGutter * pix.width))
  const padPx = Math.round(pad * pix.height)

  // Bottom-most bands first: the options are the last thing on a question crop,
  // and anything above them — a trailing stem line, an inline heading like
  // "A = ? ; B = ? ; C = ?" — is not an option.
  const collected: { band: Band; cell: { left: number; right: number } }[] = []
  const used: Band[] = []
  for (let i = below.length - 1; i >= 0 && collected.length < expected; i--) {
    const band = below[i]!
    const extent = extentOf(pix, band)
    if (!extent) continue
    const cells = dropLabelCells(cellsInBand(pix, band, extent.left, extent.right, gutterPx))
    if (!cells.length) continue
    if (collected.length + cells.length > expected) {
      return {
        ok: false,
        reason: `bands hold ${collected.length + cells.length} cell(s), need exactly ${expected}`,
        bands: [band, ...used],
      }
    }
    // Reading order within the band, and bands are being walked upwards.
    collected.unshift(...cells.map((cell) => ({ band, cell })))
    used.unshift(band)
  }

  if (collected.length !== expected) {
    return {
      ok: false,
      reason: `found ${collected.length} option cell(s) below the figure, need ${expected}`,
      bands: used,
    }
  }

  // One column or one grid, not an accident: option cells are near enough the
  // same size as each other. Wildly uneven cells mean some other layout, and a
  // guess there is a confidently wrong cut.
  const heights = used.map((b) => b.bottom - b.top + 1)
  if (Math.max(...heights) > Math.min(...heights) * 2.5) {
    return {
      ok: false,
      reason: `option rows are too uneven to trust (${Math.min(...heights)}px to ${Math.max(...heights)}px)`,
      bands: used,
    }
  }

  const padX = Math.round(pad * pix.width)
  const boxes: Box[] = collected.map(({ band, cell }) => [
    Math.round((Math.max(0, band.top - padPx) / pix.height) * 1000),
    Math.round((Math.max(0, cell.left - padX) / pix.width) * 1000),
    Math.round((Math.min(pix.height - 1, band.bottom + padPx) / pix.height) * 1000),
    Math.round((Math.min(pix.width - 1, cell.right + padX) / pix.width) * 1000),
  ])
  return { ok: true, boxes, bands: used }
}

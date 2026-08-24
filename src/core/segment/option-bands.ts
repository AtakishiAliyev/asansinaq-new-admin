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
 * Drop a narrow, isolated blob at the left edge — the "A)" label.
 *
 * Only when it is BOTH narrow and clearly separated. A label glued to its
 * picture is left alone: including the letter is untidy, and cutting the
 * picture is a lost option.
 */
function trimLabel(pix: Pixels, band: Band, left: number, right: number): number {
  const runs = columnRunsRaw(pix, band, left, right)
  if (runs.length < 2) return left
  const first = runs[0]!
  const span = right - left + 1
  const narrow = first.right - first.left + 1 <= span * 0.18
  const separated = runs[1]!.left - first.right >= span * 0.03
  return narrow && separated ? runs[1]!.left : left
}

function columnRunsRaw(
  pix: Pixels,
  band: Band,
  left: number,
  right: number,
): { left: number; right: number }[] {
  const runs: { left: number; right: number }[] = []
  let start = -1
  for (let x = left; x <= right + 1; x++) {
    let on = false
    if (x <= right) {
      for (let y = band.top; y <= band.bottom && !on; y++) {
        if (isContent(pix.data, (y * pix.width + x) * 4)) on = true
      }
    }
    if (on && start < 0) start = x
    if (!on && start >= 0) {
      runs.push({ left: start, right: x - 1 })
      start = -1
    }
  }
  return runs
}

/**
 * How the model laid the options out: how many rows, and how many per row.
 *
 * Structure is the half the model gets right. It knows a page shows five
 * options stacked, or three across and then two, even when every coordinate it
 * gives is 200 units too high — so the shape comes from the hint and only the
 * positions come from the pixels. Without a hint the only safe assumption is a
 * single column.
 */
function rowsFromHint(hint: Box[] | undefined, expected: number): number[] {
  if (!hint?.length) return new Array(expected).fill(1)
  const sorted = [...hint].sort((a, b) => a[0] - b[0])
  const rows: number[] = []
  let previous: Box | null = null
  for (const box of sorted) {
    // Same row when the boxes overlap vertically by most of their height. Two
    // options side by side share a row; the next row starts below.
    const overlaps =
      previous !== null &&
      Math.min(previous[2], box[2]) - Math.max(previous[0], box[0]) >
        (box[2] - box[0]) * 0.5
    if (overlaps) rows[rows.length - 1]!++
    else rows.push(1)
    previous = box
  }
  return rows
}

const columnRuns = columnRunsRaw

/**
 * Merge column runs down to exactly `count` groups, closing the narrowest gaps
 * first.
 *
 * The gaps inside one option — between the three circles of an answer — are
 * narrower than the gutters between options, but not by a margin any fixed
 * threshold survives across books. Merging by rank rather than by threshold
 * only needs the ordering to hold, and it uses the count the model supplied
 * instead of inventing one.
 */
function mergeToCount(
  runs: { left: number; right: number }[],
  count: number,
  minRunWidth: number,
): { left: number; right: number }[] | null {
  // Page edges, scanner specks and the tail of a rule line all show up as runs
  // one or two pixels wide. Merging by rank happily keeps one as a whole group,
  // which is how a five-option row came back with a cell seven units across:
  // the option was there, and a speck at the margin took its place in the
  // count. They are dropped before anything is merged.
  const real = runs.filter((r) => r.right - r.left + 1 >= minRunWidth)
  const usable = real.length >= count ? real : runs
  if (usable.length < count) return null
  const groups = usable.map((r) => ({ ...r }))
  while (groups.length > count) {
    let best = 0
    let bestGap = Infinity
    for (let i = 1; i < groups.length; i++) {
      const gap = groups[i]!.left - groups[i - 1]!.right
      if (gap < bestGap) {
        bestGap = gap
        best = i
      }
    }
    groups[best - 1]!.right = groups[best]!.right
    groups.splice(best, 1)
  }
  return groups
}

/**
 * Snap the option boxes to the pixels.
 *
 * `hint` is the model's own boxes. Its SHAPE is trusted — how many rows and how
 * many options per row — and its coordinates are used only to decide where to
 * start looking. Everything about where the options actually sit comes from the
 * pixels.
 *
 * It refuses rather than guesses. A cut nothing measured is a cut nobody has
 * checked, and a confidently wrong box deletes an option that the book printed
 * without leaving any trace that it did.
 */
export function localizeOptionBoxes(
  pix: Pixels,
  expected: number,
  hint?: Box[],
  options: LocalizeOptions = {},
): LocalizeResult {
  if (expected <= 0) return { ok: false, reason: 'no picture options to place', bands: [] }
  const { pad } = { ...DEFAULTS, ...options }

  const perRow = rowsFromHint(hint, expected)
  if (perRow.reduce((a, b) => a + b, 0) !== expected) {
    return { ok: false, reason: 'the hint does not add up to the option count', bands: [] }
  }

  // Generous slack: the model was 200 units too high on the case this was built
  // for, so a tight floor would exclude the very rows being looked for.
  const floor = hint?.length
    ? Math.max(0, Math.round(((Math.min(...hint.map((b) => b[0])) - 150) / 1000) * pix.height))
    : 0

  const bands = contentBands(pix, options).filter((b) => b.bottom >= floor)
  if (bands.length < perRow.length) {
    return {
      ok: false,
      reason: `found ${bands.length} content band(s) below the figure, need ${perRow.length} option row(s)`,
      bands,
    }
  }

  // The options are the bottom-most content, so the last N bands are the option
  // rows and anything above them is stem, figure or an inline heading.
  const chosen = bands.slice(bands.length - perRow.length)

  const heights = chosen.map((b) => b.bottom - b.top + 1)
  if (Math.max(...heights) > Math.min(...heights) * 2.5) {
    return {
      ok: false,
      reason: `option rows are too uneven to trust (${Math.min(...heights)}px to ${Math.max(...heights)}px)`,
      bands: chosen,
    }
  }

  const padY = Math.round(pad * pix.height)
  const padX = Math.round(pad * pix.width)
  const boxes: Box[] = []
  for (const [index, band] of chosen.entries()) {
    const extent = extentOf(pix, band)
    if (!extent) return { ok: false, reason: 'a band held no content', bands: chosen }
    const count = perRow[index]!
    // A single-option row keeps its whole width, minus the "A)" label. A row
    // holding several options is cut at its widest gutters.
    const cells =
      count === 1
        ? [{ left: trimLabel(pix, band, extent.left, extent.right), right: extent.right }]
        : mergeToCount(
            columnRuns(pix, band, extent.left, extent.right),
            count,
            Math.max(2, Math.round(pix.width * 0.01)),
          )
    if (!cells) {
      return {
        ok: false,
        reason: `row ${index + 1} cannot be split into ${count} option(s)`,
        bands: chosen,
      }
    }
    // Options in one row are printed at comparable widths. A cell far narrower
    // than its neighbours means the split landed between the wrong runs, and a
    // narrow cell is exactly how an option gets silently replaced by a margin.
    if (cells.length > 1) {
      const widths = cells.map((c) => c.right - c.left + 1)
      if (Math.min(...widths) < Math.max(...widths) * 0.25) {
        return {
          ok: false,
          reason: `row ${index + 1} split into uneven options (${Math.min(...widths)}px to ${Math.max(...widths)}px)`,
          bands: chosen,
        }
      }
    }
    for (const cell of cells) {
      boxes.push([
        Math.round((Math.max(0, band.top - padY) / pix.height) * 1000),
        Math.round((Math.max(0, cell.left - padX) / pix.width) * 1000),
        Math.round((Math.min(pix.height - 1, band.bottom + padY) / pix.height) * 1000),
        Math.round((Math.min(pix.width - 1, cell.right + padX) / pix.width) * 1000),
      ])
    }
  }
  return { ok: true, boxes, bands: chosen }
}

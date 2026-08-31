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
  /**
   * The printed question number, when the caller knows it.
   *
   * Supplied so the leading "8." can be excluded from a figure box. Used as a
   * SANITY CHECK on the glyph count and never as a licence to cut: a cluster
   * that is not the right size for this many digits is left where it is.
   */
  questionNumber?: number
}

const DEFAULTS: Omit<Required<LocalizeOptions>, 'questionNumber'> = {
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


/** Row-runs inside a region, looking only at the columns given. */
function subBands(
  pix: Pixels,
  region: Band,
  left: number,
  right: number,
  maxGap: number,
): Band[] {
  const occupied: boolean[] = []
  for (let y = region.top; y <= region.bottom; y++) {
    let on = false
    for (let x = left; x <= right && !on; x++) {
      if (isContent(pix.data, (y * pix.width + x) * 4)) on = true
    }
    occupied.push(on)
  }
  const bands: Band[] = []
  let start = -1
  for (let i = 0; i <= occupied.length; i++) {
    const on = occupied[i] === true
    if (on && start < 0) start = i
    if (!on && start >= 0) {
      const previous = bands[bands.length - 1]
      const top = region.top + start
      const bottom = region.top + i - 1
      if (previous && top - previous.bottom - 1 <= maxGap) previous.bottom = bottom
      else bands.push({ top, bottom })
      start = -1
    }
  }
  return bands
}

/** The rows actually carrying ink within a column range. */
function rowExtentOf(
  pix: Pixels,
  band: Band,
  left: number,
  right: number,
): { top: number; bottom: number } | null {
  let top = -1
  let bottom = -1
  for (let y = band.top; y <= band.bottom; y++) {
    let on = false
    for (let x = left; x <= right && !on; x++) {
      if (isContent(pix.data, (y * pix.width + x) * 4)) on = true
    }
    if (!on) continue
    if (top < 0) top = y
    bottom = y
  }
  return top < 0 ? null : { top, bottom }
}

/** Is there any content in these rows at or left of `x`? */
function contentLeftOf(pix: Pixels, top: number, bottom: number, x: number): boolean {
  for (let y = Math.max(0, top); y <= Math.min(pix.height - 1, bottom); y++) {
    for (let cx = 0; cx <= Math.min(x, pix.width - 1); cx++) {
      if (isContent(pix.data, (y * pix.width + cx) * 4)) return true
    }
  }
  return false
}

/**
 * Push a figure box past the printed question number.
 *
 * The number is not part of the figure, and four of ten reviewed rows carried
 * theirs into the cut — which then went to the reproduction lane, where the
 * model dutifully redrew "8." as though it were a label on the drawing.
 *
 * Deliberately timid, because the two mistakes here are not symmetric: leaving
 * a number in is untidy and a reviewer can see it, while cutting into the
 * drawing removes something nobody can see is gone. So it acts only on a
 * cluster that is small, isolated, sized like the digits it is supposed to be,
 * and removable without touching anything else — and otherwise leaves the box
 * exactly as it found it.
 */
function trimQuestionNumber(
  pix: Pixels,
  region: Band,
  left: number,
  right: number,
  expected: number | undefined,
  maxGap: number,
): { top: number; left: number } | null {
  if (expected === undefined || expected <= 0) return null
  const bands = subBands(pix, region, left, right, maxGap)
  const first = bands[0]
  if (!first) return null

  const runs = columnRunsRaw(pix, first, left, right)
  const head = runs[0]
  if (!head) return null

  // A printed number is SEVERAL runs. "11." is three marks separated by
  // ordinary letter spacing, and a blank column ends a run, so measuring
  // runs[0] measures one digit: 9px where the size test wanted 22-101, and
  // every multi-digit number failed it. Single digits passed only because one
  // glyph happens to be the right size for "8.", which is why the trim looked
  // like it worked.
  //
  // The cluster grows while the gaps stay glyph-sized and stops at the number
  // of marks the number can have. Absorbing part of the drawing is possible
  // where it is printed tight against the number, and it is self-limiting: the
  // cluster then measures too wide, the size test refuses, and the number is
  // left in. That is the safe direction — an untidy number is visible to a
  // reviewer, a figure cut into is not.
  const headRows = rowExtentOf(pix, first, head.left, head.right)
  if (!headRows) return null
  const marks = String(expected).length + 1
  let last = 0
  while (
    last + 1 < runs.length &&
    last + 1 < marks &&
    runs[last + 1]!.left - runs[last]!.right - 1 <= (headRows.bottom - headRows.top + 1) * 0.6
  ) {
    last += 1
  }
  const candidate = { left: head.left, right: runs[last]!.right }
  /** The first run that is NOT part of the number — the drawing, when it shares the line. */
  const after = runs[last + 1]

  // The candidate's OWN rows, not the band's. A number printed beside the
  // drawing shares its rows with the whole figure, so the band's height is the
  // figure's height and every size test on it fails open.
  const rows = rowExtentOf(pix, first, candidate.left, candidate.right)
  if (!rows) return null

  const width = candidate.right - candidate.left + 1
  const height = rows.bottom - rows.top + 1
  const spanX = right - left + 1
  const spanY = region.bottom - region.top + 1

  // Small, in both directions, relative to the figure it sits on.
  if (width > spanX * 0.16 || height > spanY * 0.16) return null
  // It must start at the LEFT of the region: a number in the middle of a
  // drawing is a label on the drawing.
  if (candidate.left - left > spanX * 0.06) return null
  // Sized like the digits it claims to be. "8." is two glyphs and "10." three,
  // and a glyph is roughly six tenths of its height — wide bounds, because the
  // point is to reject a stray rectangle, not to measure typography.
  const glyphs = String(expected).length + 1
  if (width < height * 0.3 * glyphs || width > height * 1.4 * glyphs) return null

  if (!after) {
    // Alone on its line: everything below is the figure, so drop the line.
    const next = bands[1]
    return next ? { top: next.top, left } : null
  }
  // Beside the figure: it may only be cut away if the rest of the drawing
  // stays clear of it, all the way down.
  const gap = after.left - candidate.right - 1
  if (gap < spanX * 0.02) return null
  if (contentLeftOf(pix, rows.bottom + 1, region.bottom, candidate.right)) return null
  return { top: region.top, left: after.left }
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

/**
 * Snap a FIGURE's box to the pixels.
 *
 * The same defect as the option boxes, on the other lane: on p311/16 the cut
 * came back holding the wrong region entirely, because the model's coordinates
 * were taken at face value. The model is reliable about there BEING a figure
 * and roughly where in the flow it sits; it is not reliable about the exact
 * rows, so the hint chooses which content to snap to and the pixels decide the
 * rectangle.
 *
 * A figure is one contiguous block of drawing, so this takes the content bands
 * the hint overlaps and returns their union. Where the hint overlaps nothing —
 * the coordinates were wrong enough to land on paper — it falls back to the
 * band nearest the hint's centre, and refuses when there is no content at all.
 */
export function localizeFigureBox(
  pix: Pixels,
  hint: Box | null,
  options: LocalizeOptions = {},
): { ok: true; box: Box } | { ok: false; reason: string } {
  const { pad, maxInnerGap } = { ...DEFAULTS, ...options }
  const { questionNumber } = options
  const bands = contentBands(pix, options)
  if (!bands.length) return { ok: false, reason: 'crop holds no content at all' }

  const toPx = (v: number) => Math.round((v / 1000) * pix.height)
  let chosen: Band[] = []

  if (hint) {
    const top = toPx(hint[0])
    const bottom = toPx(hint[2])
    chosen = bands.filter((b) => b.bottom >= top && b.top <= bottom)
    if (!chosen.length) {
      // The hint landed on blank paper, so it says nothing reliable about which
      // block is the figure. The TALLEST block is taken rather than the nearest:
      // a figure is a block of drawing and a stem is a line of text, and
      // "nearest" happily returns the stem whenever the hint drifts upward —
      // which is the direction these hints drift.
      chosen = [bands.reduce((a, b) => (b.bottom - b.top > a.bottom - a.top ? b : a))]
    }
  } else {
    // With no hint the largest block is the only defensible guess.
    chosen = [bands.reduce((a, b) => (b.bottom - b.top > a.bottom - a.top ? b : a))]
  }

  let top = Math.min(...chosen.map((b) => b.top))
  const bottom = Math.max(...chosen.map((b) => b.bottom))
  const extent = extentOf(pix, { top, bottom })
  if (!extent) return { ok: false, reason: 'the chosen region holds no content' }

  // The printed question number is not part of the figure.
  let left = extent.left
  const trimmed = trimQuestionNumber(
    pix,
    { top, bottom },
    extent.left,
    extent.right,
    questionNumber,
    Math.max(1, Math.round(maxInnerGap * pix.height)),
  )
  if (trimmed) {
    top = trimmed.top
    left = trimmed.left
  }

  const padY = Math.round(pad * pix.height)
  const padX = Math.round(pad * pix.width)
  return {
    ok: true,
    box: [
      Math.round((Math.max(0, top - padY) / pix.height) * 1000),
      Math.round((Math.max(0, left - padX) / pix.width) * 1000),
      Math.round((Math.min(pix.height - 1, bottom + padY) / pix.height) * 1000),
      Math.round((Math.min(pix.width - 1, extent.right + padX) / pix.width) * 1000),
    ],
  }
}

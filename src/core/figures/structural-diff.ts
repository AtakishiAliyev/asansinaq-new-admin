// Is a generated figure the same figure as the cut it was made from?
//
// The generation lane exists because a 1:1 reproduction reads better than a
// scan. The guard exists because "reads better" and "says the same thing" are
// different properties, and only the second one matters: a redrawn diagram that
// moved a shaded region answers a different question, and it does so while
// looking cleaner than the original — which is the worst possible combination
// for a reviewer skimming a queue.
//
// So this is deterministic and it is deliberately asymmetric in strictness,
// following what the operator's own sample already showed:
//
//   INK layout is checked LOOSELY. In that sample a dashed guide stopped short
//   of the axis. Harmless — the guide still says which point is meant — and a
//   strict pixel comparison would reject every reproduction over exactly that
//   kind of endpoint drift. Ink is therefore compared after dilation, so a line
//   that ends a few pixels early still counts as the same line.
//
//   COLOUR regions are checked STRICTLY. Which region is shaded IS the question
//   in these books, so a shaded area that moved, grew or changed hue is a
//   different question and not a rendering nicety.
//
// What this cannot check is the text. Reading a label needs OCR, and there is
// no OCR engine in this project; adding one is a dependency decision. Labels
// are therefore left to the model-based verification wave, which already
// compares two pictures and reports on their text — and `labelsChecked: false`
// is returned so a caller can never mistake silence here for a pass.
import { luminance, saturation, type Pixels } from '@/core/segment/image-clean'

export interface StructuralDiff {
  /** Ink overlap after dilation, 0..1. Loose by design. */
  inkIoU: number
  /** Colour-region overlap after dilation, 0..1. Strict by design. */
  colourIoU: number
  /** How much the total inked area changed, as a ratio. 1 = identical. */
  inkAreaRatio: number
  /** How much the total coloured area changed, as a ratio. 1 = identical. */
  colourAreaRatio: number
  /** Per-hue area agreement, worst bucket. Catches a recoloured region. */
  worstHueAgreement: number
  /** Distinct ink elements in the cut, and how many the generation still has. */
  elements: { inCut: number; matched: number }
  /** Always false: no OCR engine, so labels are the verify wave's job. */
  labelsChecked: false
  passed: boolean
  reasons: string[]
}

export interface DiffThresholds {
  /** Dilation radius, as a share of the smaller dimension. */
  tolerance?: number
  minInkIoU?: number
  minColourIoU?: number
  /** How far the coloured area may drift, either way. */
  colourAreaSlack?: number
  /** How far the inked area may drift. Wide enough for a stroke-weight
   *  difference, narrow enough that a vanished element shows. */
  inkAreaSlack?: number
  minHueAgreement?: number
  /** An ink component smaller than this share of the image is noise. */
  minElementArea?: number
}

const DEFAULTS: Required<DiffThresholds> = {
  // ~1.5% of the image, so on a 512px figure a stroke may drift about 8px and
  // still match. Sized for the endpoint drift the operator's sample showed.
  tolerance: 0.015,
  minInkIoU: 0.55,
  minColourIoU: 0.8,
  colourAreaSlack: 0.18,
  inkAreaSlack: 0.15,
  minHueAgreement: 0.8,
  minElementArea: 0.0006,
}

type Mask = Uint8Array

// Ink is LINE ART: dark and not deliberately coloured. Excluding coloured
// pixels keeps the two measures disjoint, and without that a shaded block
// dominates the ink figures and hides everything happening to the lines — a
// deleted guide showed as a 5% change because the shading counted as ink.
const isInk = (d: Uint8ClampedArray, i: number): boolean =>
  luminance(d, i) < 140 && saturation(d, i) < 0.28
const isColour = (d: Uint8ClampedArray, i: number): boolean =>
  saturation(d, i) >= 0.28 && luminance(d, i) < 245

/** Nearest-neighbour resample, so two figures of different sizes can be compared. */
function resample(pix: Pixels, width: number, height: number): Pixels {
  if (pix.width === width && pix.height === height) return pix
  const out = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    const sy = Math.min(pix.height - 1, Math.floor((y * pix.height) / height))
    for (let x = 0; x < width; x++) {
      const sx = Math.min(pix.width - 1, Math.floor((x * pix.width) / width))
      const from = (sy * pix.width + sx) * 4
      const to = (y * width + x) * 4
      out[to] = pix.data[from]!
      out[to + 1] = pix.data[from + 1]!
      out[to + 2] = pix.data[from + 2]!
      out[to + 3] = 255
    }
  }
  return { data: out, width, height }
}

function maskOf(pix: Pixels, test: (d: Uint8ClampedArray, i: number) => boolean): Mask {
  const mask = new Uint8Array(pix.width * pix.height)
  for (let p = 0; p < mask.length; p++) mask[p] = test(pix.data, p * 4) ? 1 : 0
  return mask
}

/**
 * Grow a mask by `r` pixels, via a summed-area table.
 *
 * This is what makes the ink comparison tolerant: after dilation, a stroke that
 * stops a few pixels short still covers the place the original's stroke was, so
 * the endpoint drift the sample showed no longer reads as a missing line.
 */
function dilate(mask: Mask, width: number, height: number, r: number): Mask {
  if (r <= 0) return mask
  const stride = width + 1
  const sum = new Int32Array(stride * (height + 1))
  for (let y = 0; y < height; y++) {
    let row = 0
    for (let x = 0; x < width; x++) {
      row += mask[y * width + x]!
      sum[(y + 1) * stride + (x + 1)] = sum[y * stride + (x + 1)]! + row
    }
  }
  const out = new Uint8Array(mask.length)
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - r)
    const y1 = Math.min(height - 1, y + r)
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - r)
      const x1 = Math.min(width - 1, x + r)
      const total =
        sum[(y1 + 1) * stride + (x1 + 1)]! -
        sum[y0 * stride + (x1 + 1)]! -
        sum[(y1 + 1) * stride + x0]! +
        sum[y0 * stride + x0]!
      out[y * width + x] = total > 0 ? 1 : 0
    }
  }
  return out
}

/**
 * Overlap of two masks, each measured against the OTHER dilated.
 *
 * Dilating both and taking a plain IoU would reward a generation that simply
 * drew more ink everywhere. Comparing each against the other's dilation asks
 * the question that matters in both directions: is everything the original had
 * still there, and is everything the generation drew something the original
 * had?
 */
function tolerantIoU(a: Mask, b: Mask, width: number, height: number, r: number): number {
  const aWide = dilate(a, width, height, r)
  const bWide = dilate(b, width, height, r)
  let aCovered = 0
  let aTotal = 0
  let bCovered = 0
  let bTotal = 0
  for (let p = 0; p < a.length; p++) {
    if (a[p]) {
      aTotal++
      if (bWide[p]) aCovered++
    }
    if (b[p]) {
      bTotal++
      if (aWide[p]) bCovered++
    }
  }
  if (!aTotal && !bTotal) return 1
  if (!aTotal || !bTotal) return 0
  // The worse direction, because a reproduction that is right one way and wrong
  // the other is wrong.
  return Math.min(aCovered / aTotal, bCovered / bTotal)
}

/** Area per hue bucket, as a share of the image. */
function hueProfile(pix: Pixels, buckets = 8): number[] {
  const out = new Array(buckets).fill(0)
  const n = pix.width * pix.height
  for (let p = 0; p < n; p++) {
    const i = p * 4
    if (!isColour(pix.data, i)) continue
    const r = pix.data[i]! / 255
    const g = pix.data[i + 1]! / 255
    const b = pix.data[i + 2]! / 255
    const mx = Math.max(r, g, b)
    const mn = Math.min(r, g, b)
    const d = mx - mn
    let h = 0
    if (d > 1e-6) {
      if (mx === r) h = ((g - b) / d) % 6
      else if (mx === g) h = (b - r) / d + 2
      else h = (r - g) / d + 4
      h *= 60
      if (h < 0) h += 360
    }
    out[Math.min(buckets - 1, Math.floor((h / 360) * buckets))]++
  }
  return out.map((v) => v / n)
}

/**
 * Distinct ink elements, as connected components of the DILATED mask.
 *
 * Dilating first is what makes a dashed guide one element rather than fifteen,
 * which is the whole reason this is measured on the dilated mask.
 *
 * It exists because pixel overlap alone cannot see a missing element: on a
 * figure whose axes carry most of the ink, deleting an entire guide line still
 * left the overlap above threshold. "Loose about where a line ends" must not
 * become "blind to whether the line is there".
 */
function components(
  mask: Mask,
  width: number,
  height: number,
  minArea: number,
): { cx: number; cy: number; area: number }[] {
  const seen = new Uint8Array(mask.length)
  const out: { cx: number; cy: number; area: number }[] = []
  const stack: number[] = []
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue
    stack.length = 0
    stack.push(start)
    seen[start] = 1
    let area = 0
    let sx = 0
    let sy = 0
    while (stack.length) {
      const p = stack.pop()!
      const x = p % width
      const y = (p - x) / width
      area++
      sx += x
      sy += y
      if (x > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1) }
      if (x < width - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1) }
      if (y > 0 && mask[p - width] && !seen[p - width]) { seen[p - width] = 1; stack.push(p - width) }
      if (y < height - 1 && mask[p + width] && !seen[p + width]) { seen[p + width] = 1; stack.push(p + width) }
    }
    if (area >= minArea) out.push({ cx: sx / area, cy: sy / area, area })
  }
  return out
}

export function compareStructure(
  cut: Pixels,
  generated: Pixels,
  thresholds: DiffThresholds = {},
): StructuralDiff {
  const t = { ...DEFAULTS, ...thresholds }
  // The cut is the reference, so the generation is resampled onto it — never
  // the other way round, which would let a low-detail generation set the terms.
  const gen = resample(generated, cut.width, cut.height)
  const r = Math.max(1, Math.round(Math.min(cut.width, cut.height) * t.tolerance))

  const inkIoU = tolerantIoU(
    maskOf(cut, isInk),
    maskOf(gen, isInk),
    cut.width,
    cut.height,
    r,
  )
  // Colour gets a much smaller tolerance: a shaded region that moved by more
  // than a hair is a different region, and that is the question itself.
  const colourIoU = tolerantIoU(
    maskOf(cut, isColour),
    maskOf(gen, isColour),
    cut.width,
    cut.height,
    Math.max(1, Math.round(r / 3)),
  )

  // Overlap and component counts both miss a whole element that happened to
  // TOUCH another: in the fixture this was written for, the guide met the
  // y-axis, so deleting it neither broke the overlap threshold nor removed a
  // component — it only removed ink. Area is the blunt instrument that sees it,
  // and it separates cleanly from endpoint drift: on that figure losing the
  // guide cost 24% of the ink and shortening it cost 2%.
  const cutInkArea = maskOf(cut, isInk).reduce<number>((a, b) => a + b, 0)
  const genInkArea = maskOf(gen, isInk).reduce<number>((a, b) => a + b, 0)
  const inkAreaRatio = cutInkArea === 0 ? (genInkArea === 0 ? 1 : 0) : genInkArea / cutInkArea

  const cutHues = hueProfile(cut)
  const genHues = hueProfile(gen)
  const cutColour = cutHues.reduce((a, b) => a + b, 0)
  const genColour = genHues.reduce((a, b) => a + b, 0)
  const colourAreaRatio = cutColour === 0 ? (genColour === 0 ? 1 : 0) : genColour / cutColour

  let worstHueAgreement = 1
  for (let i = 0; i < cutHues.length; i++) {
    const a = cutHues[i]!
    const b = genHues[i]!
    // Buckets that are empty in both say nothing; a bucket that appears or
    // vanishes is a recolour and scores zero.
    if (a < 0.002 && b < 0.002) continue
    const agreement = Math.min(a, b) / Math.max(a, b)
    if (agreement < worstHueAgreement) worstHueAgreement = agreement
  }

  // Presence, not just overlap. Generous about position and size — this is
  // asking whether the element is still there, not whether it moved slightly.
  const cutMaskWide = dilate(maskOf(cut, isInk), cut.width, cut.height, r)
  const genMaskWide = dilate(maskOf(gen, isInk), cut.width, cut.height, r)
  const minArea = Math.max(4, Math.round(cut.width * cut.height * t.minElementArea))
  const cutElements = components(cutMaskWide, cut.width, cut.height, minArea)
  const genElements = components(genMaskWide, cut.width, cut.height, minArea)
  const near = Math.max(cut.width, cut.height) * 0.12
  let matched = 0
  for (const element of cutElements) {
    const hit = genElements.some(
      (g) =>
        Math.hypot(g.cx - element.cx, g.cy - element.cy) <= near &&
        Math.max(g.area, element.area) / Math.min(g.area, element.area) <= 4,
    )
    if (hit) matched++
  }

  const reasons: string[] = []
  if (matched < cutElements.length) {
    reasons.push(
      `${cutElements.length - matched} of ${cutElements.length} drawn element(s) missing`,
    )
  }
  if (Math.abs(inkAreaRatio - 1) > t.inkAreaSlack) {
    reasons.push(
      `drawn area changed by ${((inkAreaRatio - 1) * 100).toFixed(0)}% — ` +
        'something was added or left out',
    )
  }
  if (inkIoU < t.minInkIoU) {
    reasons.push(`ink layout differs (overlap ${inkIoU.toFixed(2)} < ${t.minInkIoU})`)
  }
  if (colourIoU < t.minColourIoU) {
    reasons.push(`shaded regions differ (overlap ${colourIoU.toFixed(2)} < ${t.minColourIoU})`)
  }
  if (Math.abs(colourAreaRatio - 1) > t.colourAreaSlack) {
    reasons.push(`coloured area changed by ${((colourAreaRatio - 1) * 100).toFixed(0)}%`)
  }
  if (worstHueAgreement < t.minHueAgreement) {
    reasons.push(`a colour changed (worst hue agreement ${worstHueAgreement.toFixed(2)})`)
  }

  return {
    inkIoU,
    inkAreaRatio,
    colourIoU,
    colourAreaRatio,
    worstHueAgreement,
    elements: { inCut: cutElements.length, matched },
    labelsChecked: false,
    passed: reasons.length === 0,
    reasons,
  }
}

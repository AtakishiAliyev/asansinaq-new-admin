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
  /** How much the total inked area changed, as a ratio. 1 = identical.
   *  Reported for the record; NOT a pass criterion — see `minInkIoU`. */
  inkAreaRatio: number
  /** How much the total coloured area changed, as a ratio. 1 = identical. */
  colourAreaRatio: number
  /** Palette agreement, 1 = same colours in the same proportions. Catches a
   *  recoloured region without tripping on a hue that straddles a bucket. */
  hueAgreement: number
  /** Whether the cut had enough line art for `inkAreaRatio` to mean anything.
   *  False on a figure that is almost entirely colour. */
  inkMeasurable: boolean
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
  minHueAgreement?: number
  /**
   * Below this share of skeleton pixels, the inked area is not evidence.
   *
   * Three of the seven live figures are almost entirely colour, with a 57- to
   * 60-pixel skeleton in a 180,000-pixel image. At that size the ratio is noise
   * — a single junction thinning differently moves it by a fifth — and the
   * check was rejecting faithful reproductions on it. The structural checks
   * (overlap, and whether each element is still present) keep running at any
   * size; only the AREA check abstains, and it says so in the reasons.
   */
  minInkToMeasure?: number
  /** An ink component smaller than this share of the image is noise. */
  minElementArea?: number
}

const DEFAULTS: Required<DiffThresholds> = {
  // ~1.5% of the image, so on a 512px figure a stroke may drift about 8px and
  // still match. Sized for the endpoint drift the operator's sample showed.
  tolerance: 0.015,
  minColourIoU: 0.8,
  colourAreaSlack: 0.18,
  // Raised from 0.55 when the inked-AREA criterion was dropped. That criterion
  // was redundant — `tolerantIoU` already measures coverage in both
  // directions, so ink that went missing and ink that was invented both show
  // up here — and it was redundant in the worst way: two honest drawings of one
  // figure differ in skeleton LENGTH by up to 2x, because thinning a blurry
  // scanned blob yields a short medial axis and thinning crisp strokes yields a
  // long one. It measured the pen, and it did so with an authority that
  // overruled an overlap of 0.99.
  // 0.85, and the exact value is load bearing in both directions. The suite's
  // dropped guide is 24% of the line art and lands at 0.76, so anything looser
  // lets a whole missing line through — and because that guide TOUCHES an axis,
  // the two merge into one component and the element count cannot see it
  // either, leaving this as the only check standing. The seven live
  // reproductions sit at 0.88-0.99, so this is not near them.
  minInkIoU: 0.85,
  // 0.9 = the average coloured pixel may shift about 18 degrees of hue. The
  // seven live reproductions land at 0.95-0.99 and a red region repainted blue
  // scores 0.26, so this sits in the gap rather than near either.
  minHueAgreement: 0.9,
  minElementArea: 0.0006,
  minInkToMeasure: 0.0012,
}

type Mask = Uint8Array

// Ink is LINE ART: dark and not deliberately coloured. Excluding coloured
// pixels keeps the two measures disjoint, and without that a shaded block
// dominates the ink figures and hides everything happening to the lines — a
// deleted guide showed as a 5% change because the shading counted as ink.
const COLOUR_SATURATION = 0.28
/** Bounds on the per-image ink threshold. Below the floor a stroke is being
 *  called paper; above the ceiling paper is being called a stroke. */
const INK_FLOOR = 60
const INK_CEILING = 205
/** Used only when there is nothing to measure — a blank or single-tone image. */
const DEFAULT_INK = 140
const inkAt =
  (threshold: number) =>
  (d: Uint8ClampedArray, i: number): boolean =>
    luminance(d, i) < threshold && saturation(d, i) < COLOUR_SATURATION
const isColour = (d: Uint8ClampedArray, i: number): boolean =>
  saturation(d, i) >= COLOUR_SATURATION && luminance(d, i) < 245

/**
 * Resample to a common size, averaging over the source area.
 *
 * Area-preserving, not nearest-neighbour. Nearest-neighbour DROPS thin strokes
 * when shrinking — a 1px line in a 1024px reproduction lands between samples on
 * the way down to a 300px cut and simply disappears — so the comparison was
 * manufacturing the very ink loss it then reported.
 *
 * Averaging leaves a thin stroke as a PALE GREY smear rather than black, which
 * is why the ink threshold below is measured per image instead of fixed. An
 * earlier version tried to fix that here, by keeping the darkest sample in each
 * box: it preserved the stroke and thickened it, and the same eight figures
 * came back 167%-655% too inky instead of 40%-88% too sparse. Resampling
 * decides resolution; thresholding decides what counts as a stroke. Keeping
 * those separate is the whole repair.
 */
function resample(pix: Pixels, width: number, height: number): Pixels {
  if (pix.width === width && pix.height === height) return pix
  const out = new Uint8ClampedArray(width * height * 4)
  const fx = pix.width / width
  const fy = pix.height / height
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * fy)
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * fy))
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * fx)
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * fx))
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * pix.width + sx) * 4
          r += pix.data[i]!
          g += pix.data[i + 1]!
          b += pix.data[i + 2]!
          n++
        }
      }
      const to = (y * width + x) * 4
      out[to] = r / n
      out[to + 1] = g / n
      out[to + 2] = b / n
      out[to + 3] = 255
    }
  }
  return { data: out, width, height }
}

/**
 * Where paper stops and a stroke starts — ONE threshold, for BOTH images.
 *
 * Per-image thresholds were the third miscalibration, and the sharpest lesson
 * of the three. Both sides here are nearly binary: 94% paper, ~1% strokes, and
 * almost nothing in between. Otsu therefore has a PLATEAU — every cut-off from
 * 0 to 249 splits those two masses identically and scores identically — and the
 * only thing that separated them was the tie-break. The cut's plateau starts at
 * 0 and the generation's anti-aliased halo ends its plateau near 200, so
 * keeping the first best threshold gave the two images 100 and 199, and the
 * same drawing measured 3.5x more inked on one side than the other.
 *
 * So: one histogram over both images, and the MIDDLE of the plateau rather than
 * its edge. A shared threshold cannot be asymmetric by construction, which is
 * the property that matters — an absolute value that is slightly wrong costs
 * some stroke width on both sides equally, and the skeleton then removes it.
 */
function sharedInkThreshold(a: Pixels, b: Pixels): number {
  const hist = new Array<number>(256).fill(0)
  let total = 0
  for (const pix of [a, b]) {
    const n = pix.width * pix.height
    for (let p = 0; p < n; p++) {
      const i = p * 4
      if (saturation(pix.data, i) >= COLOUR_SATURATION) continue
      hist[Math.round(luminance(pix.data, i))]!++
      total++
    }
  }
  if (total === 0) return DEFAULT_INK
  let sum = 0
  for (let t = 0; t < 256; t++) sum += t * hist[t]!
  let wB = 0
  let sumB = 0
  let bestVar = -1
  let lo = 0
  let hi = 0
  for (let t = 0; t < 256; t++) {
    wB += hist[t]!
    if (wB === 0) continue
    const wF = total - wB
    if (wF === 0) break
    sumB += t * hist[t]!
    const between = (wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2) / (total * total)
    // A plateau, tracked by its two ends rather than by its first member.
    if (between > bestVar * (1 + 1e-9)) {
      bestVar = between
      lo = t
      hi = t
    } else if (bestVar > 0 && between >= bestVar * (1 - 1e-9)) {
      hi = t
    }
  }
  if (bestVar <= 0) return DEFAULT_INK
  return Math.min(INK_CEILING, Math.max(INK_FLOOR, Math.round((lo + hi) / 2)))
}

/**
 * Put a mask measured at one resolution onto another grid, keeping presence.
 *
 * OR rather than average, because this carries a SKELETON: a one-pixel line
 * downscaled by averaging falls below any coverage threshold and disappears,
 * which is the same bug as resampling the picture, one level down.
 */
function project(
  mask: Mask,
  width: number,
  height: number,
  toWidth: number,
  toHeight: number,
): Mask {
  if (width === toWidth && height === toHeight) return mask
  const out = new Uint8Array(toWidth * toHeight)
  for (let y = 0; y < height; y++) {
    const ty = Math.min(toHeight - 1, Math.floor((y * toHeight) / height))
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue
      out[ty * toWidth + Math.min(toWidth - 1, Math.floor((x * toWidth) / width))] = 1
    }
  }
  return out
}

/**
 * Thin a mask to a one-pixel skeleton (Zhang-Suen).
 *
 * The fix for the bias that rejected every reproduction: a 300px crop redrawn
 * at 1024px has THINNER relative strokes, and comparing inked MASS read that as
 * losing 21% to 60% of the drawing. What matters is whether the same lines are
 * in the same places, not how heavily they were laid down — so both sides are
 * reduced to their centrelines and the comparison is about structure.
 *
 * Deliberately kept as an area measure afterwards: skeleton length is still
 * area, but it is area that no longer moves with stroke weight, so a genuinely
 * missing line still shows up as missing length.
 */
function skeletonize(mask: Mask, width: number, height: number): Mask {
  const img = Uint8Array.from(mask)
  const at = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= width || y >= height ? 0 : img[y * width + x]!

  for (let pass = 0; pass < 64; pass++) {
    let removedAny = false
    for (const step of [0, 1]) {
      const doomed: number[] = []
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (!img[y * width + x]) continue
          // p2..p9 clockwise from north.
          const p = [
            at(x, y - 1),
            at(x + 1, y - 1),
            at(x + 1, y),
            at(x + 1, y + 1),
            at(x, y + 1),
            at(x - 1, y + 1),
            at(x - 1, y),
            at(x - 1, y - 1),
          ]
          const b = p.reduce<number>((a, v) => a + v, 0)
          if (b < 2 || b > 6) continue
          let transitions = 0
          for (let i = 0; i < 8; i++) {
            if (p[i] === 0 && p[(i + 1) % 8] === 1) transitions++
          }
          if (transitions !== 1) continue
          const [n, ne, e, se, sth, sw, w] = p
          if (step === 0) {
            if (n! * e! * sth! !== 0) continue
            if (e! * sth! * w! !== 0) continue
          } else {
            if (n! * e! * w! !== 0) continue
            if (n! * sth! * w! !== 0) continue
          }
          void ne
          void se
          void sw
          doomed.push(y * width + x)
        }
      }
      if (doomed.length) {
        removedAny = true
        for (const p of doomed) img[p] = 0
      }
    }
    if (!removedAny) break
  }
  return img
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

/**
 * Area per hue bucket, as a share of THIS image's coloured pixels.
 *
 * Share-of-colour rather than share-of-image, because the two sides differ in
 * resolution and in how much anti-aliasing they carry, and a bucket measured
 * against the whole image moves with both. Normalising against the image's own
 * colour makes the question "is the palette the same", which is what the check
 * is for.
 */
function hueProfile(pix: Pixels, buckets = HUE_BUCKETS): number[] {
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
  const coloured = out.reduce((a, b) => a + b, 0)
  return coloured === 0 ? out : out.map((v) => v / coloured)
}

/**
 * How far the palette had to MOVE to become the other palette (circular EMD).
 *
 * Per-bucket comparison was the second miscalibration, and it failed the same
 * way as the ink one: a single colour whose hue sits near a bucket edge lands
 * in bucket 3 on one side and bucket 4 on the other, and comparing the buckets
 * one by one reported "worst hue agreement 0.01" — a total recolour — for a
 * figure whose shading overlapped the original at 0.95. Anti-aliased edges do
 * the same thing with slivers of hue that belong to no region.
 *
 * Earth-mover distance asks the question that actually matters: how much colour
 * moved, and how far. A boundary split moves a lot of mass by one bucket and
 * scores near-identical; red becoming blue moves a lot of mass by three or four
 * and cannot hide. Circular because hue wraps, so red is next to magenta.
 */
/** 10 degrees each. Fine enough that a bucket edge is a rounding error rather
 *  than a verdict — at 45 degrees the live Venn's red straddled the wrap point
 *  and half the palette appeared to move. */
const HUE_BUCKETS = 36

function hueDistance(a: number[], b: number[]): number {
  const n = a.length
  let best = Infinity
  // The optimal circular transport is the best linear one over some starting
  // bucket, and n is 8, so trying them all is cheaper than being clever.
  for (let start = 0; start < n; start++) {
    let carry = 0
    let cost = 0
    for (let k = 0; k < n; k++) {
      const idx = (start + k) % n
      carry += a[idx]! - b[idx]!
      cost += Math.abs(carry)
    }
    if (cost < best) best = cost
  }
  return best
}

/**
 * 1 = the same palette, 0 = as far apart as hues can be.
 *
 * Normalised by the largest circular distance there is (half the wheel), so the
 * score reads as "how far the average coloured pixel had to shift, against the
 * furthest it could have shifted". With 10-degree buckets a hue that merely
 * straddles a boundary moves one bucket and costs a five-hundredth; red
 * becoming blue moves half the wheel and scores zero.
 */
function hueAgreement(a: number[], b: number[]): number {
  const cutHas = a.reduce((t, v) => t + v, 0) > 0
  const genHas = b.reduce((t, v) => t + v, 0) > 0
  // Neither side is coloured: line art, and there is no palette to disagree on.
  if (!cutHas && !genHas) return 1
  // One side lost its colour entirely. That is not a metric artefact.
  if (cutHas !== genHas) return 0
  return Math.max(0, 1 - hueDistance(a, b) / (a.length / 2))
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

  // Both sides reduced to centrelines first, so stroke weight cannot decide the
  // verdict. A reproduction drawn at 3x the cut's resolution has thinner
  // relative lines; that is a property of the rendering, not a loss of content.
  // Each side gets its own ink threshold. See `inkThreshold`: a scan and a
  // downscaled crisp render are not the same medium, and one fixed cut-off
  // measures the medium instead of the drawing.
  // Ink is measured at each image's NATIVE resolution and only then brought
  // onto a common grid.
  //
  // The order matters more than anything else in this function. Resampling
  // first and thresholding second smears a crisp 1px stroke across several
  // grey pixels, and since the cut is already hard black-and-white, every
  // threshold above black then adds pixels to the generation and none to the
  // cut. Measured on the live pairs that read as 5.6x and 8.7x more ink in
  // reproductions that had merely been drawn at higher resolution.
  //
  // Thresholding first keeps both sides crisp; projecting the MASK down puts
  // them on one grid without averaging a stroke away; and thinning happens last,
  // on that shared grid.
  //
  // Thinning at native resolution instead was the near miss: a skeleton is a
  // one-dimensional measure, so normalising its length by the image's linear
  // size looks like it should make the two comparable, and it does not. Detail
  // is not scale-invariant — a 1376px drawing simply RESOLVES structure that a
  // 562px scan merges into a blob, and its skeleton is genuinely longer for
  // that reason. Both sides must be thinned at the same resolution or the
  // comparison measures the resolution.
  const ink = inkAt(sharedInkThreshold(generated, cut))
  const cutSkeleton = skeletonize(maskOf(cut, ink), cut.width, cut.height)
  const genSkeleton = skeletonize(
    project(
      maskOf(generated, ink),
      generated.width,
      generated.height,
      cut.width,
      cut.height,
    ),
    cut.width,
    cut.height,
  )
  const inkIoU = tolerantIoU(cutSkeleton, genSkeleton, cut.width, cut.height, r)
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
  const inkMeasurable =
    cutSkeleton.reduce<number>((a, b) => a + b, 0) >=
    cut.width * cut.height * t.minInkToMeasure
  const cutInkArea = cutSkeleton.reduce<number>((a, b) => a + b, 0)
  const genInkArea = genSkeleton.reduce<number>((a, b) => a + b, 0)
  const inkAreaRatio = cutInkArea === 0 ? (genInkArea === 0 ? 1 : 0) : genInkArea / cutInkArea

  // Likewise as a share of each image, not a count on the shared grid.
  const cutColourArea =
    maskOf(cut, isColour).reduce<number>((a, b) => a + b, 0) / (cut.width * cut.height)
  const genColourArea =
    maskOf(generated, isColour).reduce<number>((a, b) => a + b, 0) /
    (generated.width * generated.height)
  const colourAreaRatio =
    cutColourArea === 0 ? (genColourArea === 0 ? 1 : 0) : genColourArea / cutColourArea

  // The palette is read at NATIVE resolution, for the same reason the ink is.
  // These figures outline their regions in colour, and an outline is a stroke:
  // resampling it desaturates its edges out of the colour mask entirely, which
  // shifts the share held by every hue and reported a faithful two-ellipse Venn
  // as a recolour at 0.78. A share of the palette is scale-free; a count of
  // pixels on someone else's grid is not.
  const cutHues = hueProfile(cut)
  const genHues = hueProfile(generated)

  const hueMatch = hueAgreement(cutHues, genHues)

  // Presence, not just overlap. Generous about position and size — this is
  // asking whether the element is still there, not whether it moved slightly.
  const cutMaskWide = dilate(cutSkeleton, cut.width, cut.height, r)
  const genMaskWide = dilate(genSkeleton, cut.width, cut.height, r)
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
  // Every INK check is gated on there being enough line art to measure. On a
  // figure drawn almost entirely in colour the black channel is labels, and
  // labels are exactly what this function declares it does not check — see
  // `labelsChecked`. Judging their pixel geometry anyway rejected three
  // faithful reproductions on skeletons of 57 to 60 pixels. Colour, which is
  // where those figures carry their meaning, is checked strictly and
  // unconditionally below.
  if (inkMeasurable && matched < cutElements.length) {
    reasons.push(
      `${cutElements.length - matched} of ${cutElements.length} drawn element(s) missing`,
    )
  }

  if (inkMeasurable && inkIoU < t.minInkIoU) {
    reasons.push(`ink layout differs (overlap ${inkIoU.toFixed(2)} < ${t.minInkIoU})`)
  }
  if (colourIoU < t.minColourIoU) {
    reasons.push(`shaded regions differ (overlap ${colourIoU.toFixed(2)} < ${t.minColourIoU})`)
  }
  if (Math.abs(colourAreaRatio - 1) > t.colourAreaSlack) {
    reasons.push(`coloured area changed by ${((colourAreaRatio - 1) * 100).toFixed(0)}%`)
  }
  if (hueMatch < t.minHueAgreement) {
    reasons.push(`a colour changed (palette agreement ${hueMatch.toFixed(2)})`)
  }

  return {
    inkIoU,
    inkAreaRatio,
    colourIoU,
    colourAreaRatio,
    hueAgreement: hueMatch,
    inkMeasurable,
    elements: { inCut: cutElements.length, matched },
    labelsChecked: false,
    passed: reasons.length === 0,
    reasons,
  }
}

// Removing a watermark without removing the drawing.
//
// Pure and runtime-agnostic: it takes raw RGBA bytes and returns raw RGBA
// bytes, so the worker, the browser and the eval all run the same cleaner. No
// canvas, no DOM — the caller owns decoding and encoding.
//
// The measurements this is built on, from `scripts/dewatermark-probe.ts` over
// six real crops: a global Otsu threshold and a plain adaptive threshold both
// remove the watermark AND one hundred percent of the colour. On these books
// that is not a cleaned figure, it is a destroyed question — an IQ item whose
// answer is the order of a red, a green and a black circle does not survive
// being flattened to black and white. Keeping saturated pixels costs nothing
// and preserved the colour pixel-exactly on all three coloured crops.

export interface Pixels {
  /** RGBA, 4 bytes per pixel, row-major. */
  data: Uint8ClampedArray
  width: number
  height: number
}

export const luminance = (d: Uint8ClampedArray, i: number): number =>
  0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!

/** HSV saturation: 0 for a perfectly grey pixel, 1 for a pure hue. */
export function saturation(d: Uint8ClampedArray, i: number): number {
  const max = Math.max(d[i]!, d[i + 1]!, d[i + 2]!)
  const min = Math.min(d[i]!, d[i + 1]!, d[i + 2]!)
  return max === 0 ? 0 : (max - min) / max
}

export interface CleanOptions {
  /**
   * Side of the neighbourhood the local mean is taken over, in pixels.
   *
   * Must be much wider than a watermark stroke. Too narrow and the mean sits
   * INSIDE the watermark, which then reads as ink against its own background
   * and survives — the failure that makes adaptive thresholding look like it
   * did nothing at all.
   */
  window?: number
  /** How much darker than its neighbourhood a pixel must be to count as ink. */
  margin?: number
  /** At or above this saturation a pixel is deliberate colour and is kept. */
  keepSaturation?: number
  /**
   * Nothing lighter than this may become ink, however much it stands out from
   * its neighbourhood.
   *
   * Without it "remove the watermark" and "turn the watermark into ink" score
   * identically on any count of pale pixels, because a promoted pixel simply
   * moves into the ink bucket. Measured over eight real crops, the local
   * contrast test alone promoted 0.4% to 3.8% of every page to solid black —
   * the darker edges of a logo becoming strokes on a Venn diagram, which is
   * worse than the faint marks they replaced. Real print on these scans sits at
   * luminance 0-19 and the washes at 200-239, so the floor has a wide margin to
   * land in.
   */
  inkCeiling?: number
}

const DEFAULTS: Required<CleanOptions> = {
  window: 61,
  margin: 12,
  keepSaturation: 0.28,
  inkCeiling: 150,
}

/**
 * Mean luminance over the window around every pixel, via a summed-area table.
 *
 * Exact and O(pixels) regardless of window size, which matters because the
 * window has to be large: a 61-wide box blur done naively is 3721 reads per
 * pixel and turns a 900x700 crop into seconds of work.
 */
function localMean(pix: Pixels, window: number): Float64Array {
  const { width: w, height: h, data } = pix
  const stride = w + 1
  const sum = new Float64Array(stride * (h + 1))
  for (let y = 0; y < h; y++) {
    let row = 0
    for (let x = 0; x < w; x++) {
      row += luminance(data, (y * w + x) * 4)
      sum[(y + 1) * stride + (x + 1)] = sum[y * stride + (x + 1)]! + row
    }
  }
  const r = Math.max(1, Math.floor(window / 2))
  const out = new Float64Array(w * h)
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r)
    const y1 = Math.min(h - 1, y + r)
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r)
      const x1 = Math.min(w - 1, x + r)
      const total =
        sum[(y1 + 1) * stride + (x1 + 1)]! -
        sum[y0 * stride + (x1 + 1)]! -
        sum[(y1 + 1) * stride + x0]! +
        sum[y0 * stride + x0]!
      out[y * w + x] = total / ((y1 - y0 + 1) * (x1 - x0 + 1))
    }
  }
  return out
}

/**
 * Watermark and bleed-through out, strokes and colour in.
 *
 * A watermark sits at nearly the same level as the paper around it and fails
 * the margin test; a printed stroke is far darker than the white it sits on and
 * passes. Bleed-through from the reverse side is faint for the same reason and
 * goes with the watermark. Saturated pixels never face the test at all.
 *
 * Returns a NEW buffer; the input is untouched, because the caller stores the
 * original alongside the cleaned copy.
 */
export function cleanCrop(pix: Pixels, options: CleanOptions = {}): Pixels {
  const { window, margin, keepSaturation, inkCeiling } = { ...DEFAULTS, ...options }
  const out = new Uint8ClampedArray(pix.data)
  const mean = localMean(pix, window)
  const n = pix.width * pix.height
  for (let p = 0; p < n; p++) {
    const i = p * 4
    out[i + 3] = 255
    const lum = luminance(pix.data, i)
    // Deliberate colour is content by definition here: the palette is the
    // question, not decoration.
    if (saturation(pix.data, i) >= keepSaturation && lum < 245) continue
    // Both tests: darker than its surroundings AND as dark as print actually
    // is. The first alone invents strokes out of a watermark's own shading.
    const v = lum < mean[p]! - margin && lum < inkCeiling ? 0 : 255
    out[i] = out[i + 1] = out[i + 2] = v
  }
  return { data: out, width: pix.width, height: pix.height }
}

/** Share of pixels darker than mid-grey. A cleaner that ate the drawing shows
 *  up as a number far below the original's. */
export function inkRatio(pix: Pixels): number {
  let dark = 0
  const n = pix.width * pix.height
  for (let p = 0; p < n; p++) if (luminance(pix.data, p * 4) < 128) dark++
  return dark / n
}

/**
 * Ink that was not in the original.
 *
 * The measurement that catches a cleaner turning a watermark into a drawing.
 * Any count of pale pixels reports that case as success, because the promoted
 * pixels leave the pale bucket exactly as they would if they had been erased.
 */
export function inventedInk(before: Pixels, after: Pixels): number {
  let promoted = 0
  const n = before.width * before.height
  for (let p = 0; p < n; p++) {
    const i = p * 4
    if (luminance(after.data, i) >= 128) continue
    if (saturation(before.data, i) >= 0.35) continue
    if (luminance(before.data, i) >= 190) promoted++
  }
  return promoted / n
}

/** Share of pixels carrying deliberate colour. */
export function colourRatio(pix: Pixels, keepSaturation = DEFAULTS.keepSaturation): number {
  let sat = 0
  const n = pix.width * pix.height
  for (let p = 0; p < n; p++) {
    const i = p * 4
    if (saturation(pix.data, i) >= keepSaturation && luminance(pix.data, i) < 245) sat++
  }
  return sat / n
}

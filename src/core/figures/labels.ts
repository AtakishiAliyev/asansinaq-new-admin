// Did the reproduction keep the writing?
//
// The structural guard says plainly that it does not read labels: it compares
// skeletons, shaded regions and hue, and a "3" redrawn as an "8" moves none of
// those. That gap was theoretical until a reviewed row came back with the
// y-axis label simply absent from an otherwise faithful reproduction — the
// figure was right, the guard was right about the figure, and the question had
// quietly lost the name of its own axis.
//
// This half is pure on purpose. Running an OCR engine needs a runtime, a
// downloaded model and several seconds; deciding what its output MEANS needs
// none of those, and is the part that has to be argued about and pinned in the
// suite. The engine lives in the worker and hands its words to this.
//
// The asymmetry that shapes every threshold here: a false rejection costs
// QUALITY — the cut is kept, and the cut is the source's own pixels, so the
// question stays correct and merely looks like a scan. A false acceptance costs
// CORRECTNESS, and it does so on a figure that looks cleaner than the original
// while saying something else. So when this is unsure, it rejects.

export interface OcrToken {
  text: string
  /** 0-100, as the engine reports it. */
  confidence: number
}

export interface LabelDiff {
  /**
   * False when the cut yielded nothing readable, so there was no claim to test.
   *
   * Abstaining out loud rather than passing silently, for the same reason the
   * structural guard reports `inkMeasurable`: a caller must never be able to
   * read "found nothing wrong" as "checked and found nothing wrong".
   */
  checked: boolean
  /** Labels read confidently in the cut that appear nowhere in the reproduction. */
  missing: string[]
  passed: boolean
}

export interface LabelOptions {
  /**
   * How sure the engine must be about a word in the CUT before its absence is
   * evidence.
   *
   * The two populations OVERLAP, and pretending otherwise would be the easy
   * mistake here. Over seven live pairs the noise tesseract invents from curves
   * and dashed guides ran to 80, and a perfectly real axis label came back at
   * 81. There is no threshold that keeps every label and drops every ghost.
   *
   * 88 is chosen from which way the errors hurt. Sitting above the overlap
   * means some genuine labels are never examined — they are left to the
   * verification wave, which reads text as part of comparing the whole
   * question — while dropping into it would spend refusals on words the engine
   * hallucinated. Measured at 88, one faithful pair in seven is refused; at 80,
   * two are.
   */
  minConfidence?: number
}

const DEFAULTS: Required<LabelOptions> = {
  minConfidence: 88,
}

/**
 * Strip what OCR adds at the edges of a word without touching what it says.
 *
 * Case is KEPT. It is tempting to fold it — the two sides disagree about it
 * often enough — but the whole point here is to notice a changed glyph, and a
 * figure that distinguishes f from F is exactly the kind that would suffer.
 */
function normalize(text: string): string {
  return text.trim().replace(/^[^\w()+\-*/=<>.,]+|[^\w()+\-*/=<>.,]+$/g, '')
}

/** A word has to carry a letter or a digit to be a label at all. */
const isLabel = (text: string): boolean => /[\p{L}\p{N}]/u.test(text)

export function compareLabels(
  cut: OcrToken[],
  gen: OcrToken[],
  options: LabelOptions = {},
): LabelDiff {
  const { minConfidence } = { ...DEFAULTS, ...options }

  const wanted = cut
    .map((t) => ({ ...t, text: normalize(t.text) }))
    .filter((t) => t.confidence >= minConfidence && isLabel(t.text))

  const found = gen.map((t) => normalize(t.text)).filter(isLabel)
  // Joined as well as listed, because the two sides disagree about where one
  // word ends: "f(x)" comes back whole from a crisp render and as "f" and "(x)"
  // from a scan, and neither reading is wrong about the figure.
  const haystack = found.join(' ')

  const missing: string[] = []
  for (const token of wanted) {
    const hit =
      found.some((f) => f === token.text || f.includes(token.text) || token.text.includes(f)) ||
      haystack.includes(token.text)
    if (!hit && !missing.includes(token.text)) missing.push(token.text)
  }

  return {
    checked: wanted.length > 0,
    missing,
    // A figure with no readable writing PASSES, and says `checked: false` about
    // it. Many figures carry no text worth the name, and failing them here
    // would reject them for the crime of being drawings — the same mistake the
    // ink checks made before they learned to abstain. Absence of a test is
    // reported, never disguised as either verdict.
    passed: missing.length === 0,
  }
}

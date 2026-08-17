// Deterministic comparison of two extracted questions. Shared by the eval
// harness (golden vs. current) and cross-model verification (primary vs. second
// read). Math segments must match EXACTLY (after canonicalization) — this is
// what catches sign flips / digit swaps; prose is compared fuzzily.

import type { ExtractedQuestion } from '@/core/questions/extraction'
import type { FigureDoc } from '@/core/figures/figspec'

export interface FieldDiff {
  field: string // e.g. "stem", "option B", "figure"
  a: string
  b: string
}

export interface CompareResult {
  equal: boolean
  diffs: FieldDiff[]
}

// Canonicalize a LaTeX fragment so cosmetically-different but equal math compares
// equal, while sign/digit differences remain distinct.
function canonMath(s: string): string {
  return s
    .replace(/\s+/g, '')
    .replace(/\\dfrac/g, '\\frac')
    .replace(/\\tfrac/g, '\\frac')
    .replace(/\\cdot|\\times/g, '*')
    .replace(/\\left|\\right/g, '')
    .replace(/\\!/g, '')
    .replace(/\{\}/g, '')
    .replace(/[−–—]/g, '-') // unicode minus variants → ascii
    .replace(/\\,/g, '')
    .toLowerCase()
}

// Split a stem into math ($...$) and prose parts; compare part-by-part.
type Part = { math: boolean; value: string }
function parts(text: string): Part[] {
  const out: Part[] = []
  const re = /\$\$([\s\S]+?)\$\$|\$([^$]+?)\$/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ math: false, value: text.slice(last, m.index) })
    out.push({ math: true, value: m[1] ?? m[2] })
    last = re.lastIndex
  }
  if (last < text.length) out.push({ math: false, value: text.slice(last) })
  return out
}

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (!m) return n
  if (!n) return m
  const dp = new Array(n + 1)
  for (let j = 0; j <= n; j++) dp[j] = j
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return dp[n]
}

function proseSimilar(a: string, b: string, threshold = 0.92): boolean {
  const na = a.replace(/\s+/g, ' ').trim().toLowerCase()
  const nb = b.replace(/\s+/g, ' ').trim().toLowerCase()
  if (na === nb) return true
  const maxLen = Math.max(na.length, nb.length)
  if (!maxLen) return true
  return 1 - levenshtein(na, nb) / maxLen >= threshold
}

// Compare two stems: concatenate math parts (exact canonical) and prose parts
// (fuzzy). Returns null if equal, else a short reason.
function stemDiff(a: string, b: string): string | null {
  const pa = parts(a)
  const pb = parts(b)
  const mathA = pa.filter((p) => p.math).map((p) => canonMath(p.value))
  const mathB = pb.filter((p) => p.math).map((p) => canonMath(p.value))
  if (mathA.join('|') !== mathB.join('|')) return `math: [${mathA.join(', ')}] ≠ [${mathB.join(', ')}]`
  const proseA = pa.filter((p) => !p.math).map((p) => p.value).join(' ')
  const proseB = pb.filter((p) => !p.math).map((p) => p.value).join(' ')
  if (!proseSimilar(proseA, proseB)) return 'prose fərqi'
  return null
}

// Pairwise option-content equality. TeX vs TeX is exact canonical math (this is
// what catches sign flips / digit swaps). Image vs image is coarsely equal —
// like two rasters, pixels are compared elsewhere (P3). Image vs TeX is never
// equal: the two reads disagree about what the option even is.
function optionContentEqual(a: { tex?: string; image?: string }, b: { tex?: string; image?: string }): boolean {
  const aImg = a.image != null
  const bImg = b.image != null
  if (aImg && bImg) return true
  if (aImg !== bImg) return false
  return canonMath(a.tex ?? '') === canonMath(b.tex ?? '')
}

// Coarse figure signature: the sorted list of figure KINDS present. Detailed
// specs (spline points, tick counts) vary run-to-run and model-to-model, so
// comparing them yields false regressions; a kind-level match catches the real
// failure — a figure vanishing or changing type. Pixel/topology fidelity of a
// figure is validated separately by render-and-compare (P3).
function figureSignature(doc: FigureDoc | null): string {
  if (!doc || !doc.items.length) return 'none'
  return doc.items
    .map((it) => it.kind)
    .sort()
    .join('+')
}

export function compareQuestions(a: ExtractedQuestion, b: ExtractedQuestion): CompareResult {
  const diffs: FieldDiff[] = []

  const sd = stemDiff(a.stem, b.stem)
  if (sd) diffs.push({ field: 'stem', a: a.stem, b: b.stem })

  if (a.options.length !== b.options.length) {
    diffs.push({ field: 'options', a: `${a.options.length} variant`, b: `${b.options.length} variant` })
  } else {
    for (let i = 0; i < a.options.length; i++) {
      const oa = a.options[i]
      const ob = b.options[i]
      if (oa.label !== ob.label || !optionContentEqual(oa, ob)) {
        diffs.push({ field: `option ${oa.label}`, a: oa.tex ?? '[şəkil]', b: ob.tex ?? '[şəkil]' })
      }
    }
  }

  const fa = figureSignature(a.figures)
  const fb = figureSignature(b.figures)
  // Two raster images are treated as equal (pixels compared elsewhere, P3).
  if (!(fa === 'image' && fb === 'image') && fa !== fb) {
    diffs.push({ field: 'figure', a: fa, b: fb })
  }

  return { equal: diffs.length === 0, diffs }
}

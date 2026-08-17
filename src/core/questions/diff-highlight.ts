// Token-level diff between the PDF text-layer (ground truth for digital PDFs)
// and the extracted stem, so the reviewer's eye jumps straight to disagreements
// instead of re-reading the whole question. Best-effort: for scans the text
// layer is empty and this returns nothing.

export interface TokenDiff {
  layer: string // token seen in the text layer
  extracted: string // aligned token in the extraction (or '∅')
}

// Normalize: strip $...$ math delimiters and LaTeX commands to bare symbols so
// text-layer plain tokens align with rendered-math tokens.
function toTokens(s: string): string[] {
  return s
    .replace(/\$+/g, ' ')
    .replace(/\\[a-zA-Z]+/g, ' ')
    .replace(/[{}\\]/g, ' ')
    .replace(/[.,;:]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
}

// LCS-based alignment; report tokens present in the text layer but missing or
// changed in the extraction, and vice versa. Returns up to `max` diffs.
export function stemDiffTokens(textLayer: string, extracted: string, max = 8): TokenDiff[] {
  const a = toTokens(textLayer)
  const b = toTokens(extracted)
  if (!a.length) return []

  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])

  const diffs: TokenDiff[] = []
  let i = 0
  let j = 0
  while (i < m && j < n && diffs.length < max) {
    if (a[i] === b[j]) {
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      diffs.push({ layer: a[i], extracted: '∅' })
      i++
    } else {
      diffs.push({ layer: '∅', extracted: b[j] })
      j++
    }
  }
  while (i < m && diffs.length < max) diffs.push({ layer: a[i++], extracted: '∅' })
  while (j < n && diffs.length < max) diffs.push({ layer: '∅', extracted: b[j++] })
  return diffs
}

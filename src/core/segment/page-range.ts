// "4-8, 11, 15-16" → [4,5,6,7,8,11,15,16]. Deduplicated, sorted, validated
// against the document's page count. Returns an error message (az) instead of
// throwing, so forms can surface it directly.

export type PageRangeResult =
  { ok: true; pages: number[] } | { ok: false; error: string }

export function parsePageRange(
  input: string,
  pageCount: number,
): PageRangeResult {
  const trimmed = input.trim()
  if (!trimmed) return { ok: false, error: 'Səhifə aralığı boş ola bilməz' }

  const pages = new Set<number>()
  for (const part of trimmed.split(',')) {
    const piece = part.trim()
    if (!piece) continue
    const m = piece.match(/^(\d+)(?:\s*-\s*(\d+))?$/)
    if (!m) return { ok: false, error: `Yanlış format: «${piece}»` }
    const from = Number(m[1])
    const to = m[2] ? Number(m[2]) : from
    if (from < 1 || to < from) {
      return { ok: false, error: `Yanlış aralıq: «${piece}»` }
    }
    if (to > pageCount) {
      return {
        ok: false,
        error: `Səhifə ${to} yoxdur — sənəddə ${pageCount} səhifə var`,
      }
    }
    for (let p = from; p <= to; p++) pages.add(p)
  }
  if (pages.size === 0)
    return { ok: false, error: 'Səhifə aralığı boş ola bilməz' }
  return { ok: true, pages: [...pages].sort((a, b) => a - b) }
}

// Lenient variant for live UI state (thumbnail toggling): bad pieces are
// ignored instead of failing the whole parse.
export function parsePagesLenient(
  input: string,
  pageCount: number,
): Set<number> {
  const pages = new Set<number>()
  for (const part of input.split(',')) {
    const m = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/)
    if (!m) continue
    const from = Number(m[1])
    const to = Math.min(m[2] ? Number(m[2]) : from, pageCount)
    for (let p = Math.max(1, from); p <= to; p++) pages.add(p)
  }
  return pages
}

// [4,5,6,7,8,11] → "4-8, 11"
export function formatPages(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b)
  const parts: string[] = []
  let i = 0
  while (i < sorted.length) {
    let j = i
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++
    parts.push(i === j ? `${sorted[i]}` : `${sorted[i]}-${sorted[j]}`)
    i = j + 1
  }
  return parts.join(', ')
}

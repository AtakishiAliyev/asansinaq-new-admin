import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import {
  DEFAULT_PROFILE,
  type Band,
  type PageSeg,
  type SegItem,
  type SourceProfile,
} from '@/core/segment/types'

// Deterministic, AI-free question segmentation from the PDF text layer.
// Generic-first: nothing here assumes one publisher. Columns come from the
// real x-gap, watermarks from rotation, anchors from several numbering styles,
// and header/footer cuts keep page chrome out of the geometry. A SourceProfile
// only tunes thresholds for a stubborn book; the AI scan path is the universal
// fallback.

function itemsFromContent(
  content: { items: unknown[] },
  pageHeight: number,
): SegItem[] {
  const out: SegItem[] = []
  for (const raw of content.items as {
    str: string
    transform: number[]
    width: number
    height: number
  }[]) {
    if (!raw.str || !raw.str.trim()) continue
    const [a, b, , , e, f] = raw.transform
    out.push({
      str: raw.str,
      x: e,
      yTop: pageHeight - f - raw.height, // baseline → top-left origin
      w: raw.width,
      h: raw.height,
      angle: Math.atan2(b, a),
    })
  }
  return out
}

function isWatermark(it: SegItem, profile: SourceProfile): boolean {
  if (Math.abs(it.angle) > profile.watermarkAngle) return true
  if (
    profile.watermarkPattern &&
    profile.watermarkPattern.test(it.str) &&
    Math.abs(it.angle) > 0.02
  ) {
    return true
  }
  return false
}

interface Header {
  testNo?: number
  /** Bottom edge (pt) of the matched header row; content starts below it. */
  bottom: number
}

// Find the header row in the top zone. Its bottom edge becomes the content
// cut, so header text never participates in column/anchor geometry (a centered
// banner crossing the gutter would otherwise collapse the column split).
// Header runs are often split ("Test" + "1"), so join each row in x order.
function findHeader(
  items: SegItem[],
  pageHeight: number,
  profile: SourceProfile,
): Header {
  if (!profile.headerPattern) return { bottom: 0 }
  const topItems = items.filter((it) => it.yTop < pageHeight * 0.1)
  const rows = new Map<number, SegItem[]>()
  for (const it of topItems) {
    const key = Math.round(it.yTop / 6)
    const row = rows.get(key) ?? []
    row.push(it)
    rows.set(key, row)
  }
  for (const row of rows.values()) {
    const joined = row
      .sort((p, q) => p.x - q.x)
      .map((it) => it.str)
      .join(' ')
    const m = joined.match(profile.headerPattern)
    if (m) {
      const bottom = Math.max(...row.map((it) => it.yTop + it.h)) + 6
      return { testNo: m[1] ? Number(m[1]) : undefined, bottom }
    }
  }
  return { bottom: 0 }
}

// Column split by stripe-wise occupancy. A single wide item (table, full-width
// instruction line) must not erase the gutter, so the page is cut into
// horizontal stripes and an x-position counts as free when it is empty in a
// large majority of non-empty stripes — a real gutter survives one spanning
// row, ragged line endings still do not.
const STRIPES = 16
const FREE_STRIPE_RATIO = 0.8

function splitColumns(
  items: SegItem[],
  pageWidth: number,
  pageHeight: number,
  profile: SourceProfile,
): SegItem[][] {
  const width = Math.ceil(pageWidth)
  const stripeH = pageHeight / STRIPES
  const occupied: Uint8Array[] = Array.from(
    { length: STRIPES },
    () => new Uint8Array(width),
  )
  const stripeHasItems = new Uint8Array(STRIPES)
  for (const it of items) {
    const from = Math.max(0, Math.floor(it.x))
    const to = Math.min(width - 1, Math.ceil(it.x + it.w))
    const s0 = Math.max(0, Math.floor(it.yTop / stripeH))
    const s1 = Math.min(STRIPES - 1, Math.floor((it.yTop + it.h) / stripeH))
    for (let s = s0; s <= s1; s++) {
      occupied[s].fill(1, from, to + 1)
      stripeHasItems[s] = 1
    }
  }
  const activeStripes: number[] = []
  for (let s = 0; s < STRIPES; s++) if (stripeHasItems[s]) activeStripes.push(s)
  if (!activeStripes.length) return [items]
  const needed = Math.ceil(activeStripes.length * FREE_STRIPE_RATIO)

  const lo = Math.floor(pageWidth * 0.25)
  const hi = Math.ceil(pageWidth * 0.75)
  let bestStart = -1
  let bestLen = 0
  let runStart = -1
  for (let x = lo; x <= hi; x++) {
    let freeIn = 0
    for (const s of activeStripes) if (occupied[s][x] === 0) freeIn++
    if (freeIn >= needed) {
      if (runStart < 0) runStart = x
      const len = x - runStart + 1
      if (len > bestLen) {
        bestLen = len
        bestStart = runStart
      }
    } else {
      runStart = -1
    }
  }
  if (bestLen < profile.minGutterPt) return [items]
  const gutterMid = bestStart + bestLen / 2
  const left = items.filter((it) => it.x + it.w / 2 < gutterMid)
  const right = items.filter((it) => it.x + it.w / 2 >= gutterMid)
  if (left.length < 3 || right.length < 3) return [items]
  return [left, right]
}

interface Anchor {
  number: number
  yTop: number
  x: number
}

// "12." / "12)" possibly fused with the stem's first word, or a standalone
// narrow "12" token. All must sit at the column's left margin.
function anchorNumber(it: SegItem): number | null {
  const fused = it.str.match(/^\s*(\d{1,3})[.)](?:\s|$)/)
  if (fused) return Number(fused[1])
  const bare = it.str.match(/^\s*(\d{1,3})\s*$/)
  if (bare && it.w < 24) return Number(bare[1])
  return null
}

function findAnchors(colItems: SegItem[], profile: SourceProfile): Anchor[] {
  if (!colItems.length) return []
  const colLeft = Math.min(...colItems.map((it) => it.x))
  const candidates: Anchor[] = []
  for (const it of colItems) {
    const n = anchorNumber(it)
    if (n === null || n < 1 || n > profile.maxQuestionNumber) continue
    if (it.x > colLeft + profile.anchorIndentPt) continue
    candidates.push({ number: n, yTop: it.yTop, x: it.x })
  }
  candidates.sort((p, q) => p.yTop - q.yTop)

  // Longest increasing chain (gap ≤ 2), not first-candidate greedy: a stray
  // "2." sitting above the real question 1 must lose to the 1..n run, not
  // poison it.
  const chainLen = candidates.map(() => 1)
  const prev = candidates.map(() => -1)
  let bestEnd = -1
  for (let i = 0; i < candidates.length; i++) {
    for (let j = 0; j < i; j++) {
      const step = candidates[i].number - candidates[j].number
      if (step >= 1 && step <= 2 && chainLen[j] + 1 > chainLen[i]) {
        chainLen[i] = chainLen[j] + 1
        prev[i] = j
      }
    }
    if (bestEnd < 0 || chainLen[i] > chainLen[bestEnd]) bestEnd = i
  }
  if (bestEnd < 0) return []
  const kept: Anchor[] = []
  for (let i = bestEnd; i >= 0; i = prev[i]) {
    kept.unshift(candidates[i])
    if (prev[i] < 0) break
  }
  return kept
}

function buildBands(
  anchors: Anchor[],
  colItems: SegItem[],
  col: number,
  contentBottom: number,
): Band[] {
  const colLeft = Math.min(...colItems.map((it) => it.x))
  const colRight = Math.max(...colItems.map((it) => it.x + it.w))
  // Body content above the first anchor (a shared passage, an instruction
  // block) belongs to question 1's crop — the header was already cut, so
  // whatever remains up there is real content that must not vanish.
  const aboveFirst = colItems.filter((it) => it.yTop < anchors[0].yTop)
  const contentTop =
    (aboveFirst.length
      ? Math.min(...aboveFirst.map((it) => it.yTop))
      : anchors[0].yTop) - 2
  const bands: Band[] = []
  for (let i = 0; i < anchors.length; i++) {
    const top =
      i === 0 ? contentTop : (anchors[i - 1].yTop + anchors[i].yTop) / 2
    const bottom =
      i === anchors.length - 1
        ? contentBottom
        : (anchors[i].yTop + anchors[i + 1].yTop) / 2
    const inside = colItems.filter(
      (it) => it.yTop >= top - 2 && it.yTop <= bottom + 2,
    )
    inside.sort((p, q) => p.yTop - q.yTop || p.x - q.x)
    bands.push({
      number: anchors[i].number,
      col,
      bbox: { x: colLeft - 4, y: top, w: colRight - colLeft + 8, h: bottom - top },
      anchorYTop: anchors[i].yTop,
      textLayer: inside
        .map((it) => it.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    })
  }
  return bands
}

export async function segmentPage(
  page: PDFPageProxy,
  profile: SourceProfile = DEFAULT_PROFILE,
): Promise<PageSeg> {
  const viewport = page.getViewport({ scale: 1 })
  const pageWidth = viewport.width
  const pageHeight = viewport.height
  const content = await page.getTextContent()
  const allItems = itemsFromContent(content, pageHeight)
  const notes: string[] = []

  // Little to no text layer → scanned/image page. The AI scan path owns it.
  if (allItems.length < profile.minTextItems) {
    return {
      pageNumber: page.pageNumber,
      width: pageWidth,
      height: pageHeight,
      bands: [],
      notes,
      isScan: true,
    }
  }

  const items = allItems.filter((it) => !isWatermark(it, profile))
  const header = findHeader(items, pageHeight, profile)
  const contentBottom = pageHeight - profile.footerPt
  const bodyItems = items.filter(
    (it) => it.yTop >= header.bottom && it.yTop <= contentBottom,
  )

  const bands: Band[] = []
  splitColumns(bodyItems, pageWidth, pageHeight, profile).forEach(
    (colItems, ci) => {
      if (!colItems.length) return
      const anchors = findAnchors(colItems, profile)
      if (!anchors.length) return
      bands.push(...buildBands(anchors, colItems, ci, contentBottom))
    },
  )

  bands.sort((p, q) => p.col - q.col || p.bbox.y - q.bbox.y)
  if (!bands.length) {
    notes.push('Sual ankeri tapılmadı — səhifə AI yolu ilə emal oluna bilər')
  }

  return {
    pageNumber: page.pageNumber,
    width: pageWidth,
    height: pageHeight,
    testNo: header.testNo,
    bands,
    notes,
    isScan: false,
  }
}

export async function segmentPages(
  doc: PDFDocumentProxy,
  pages: number[],
  profile: SourceProfile = DEFAULT_PROFILE,
): Promise<PageSeg[]> {
  const out: PageSeg[] = []
  for (const p of pages) {
    const page = await doc.getPage(p)
    out.push(await segmentPage(page, profile))
  }
  return out
}

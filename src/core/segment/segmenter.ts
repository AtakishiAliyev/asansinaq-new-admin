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
    // pdf.js emits the affine matrix as six numbers, so the slots destructured
    // below always exist.
    transform: [number, number, number, number, number, number]
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

interface ColumnSplit {
  cols: SegItem[][]
  gutterMid: number | null
}

function splitColumns(
  items: SegItem[],
  pageWidth: number,
  pageHeight: number,
  profile: SourceProfile,
): ColumnSplit {
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
      // s0/s1 are already clamped into [0, STRIPES - 1].
      occupied[s]!.fill(1, from, to + 1)
      stripeHasItems[s] = 1
    }
  }
  const activeStripes: number[] = []
  for (let s = 0; s < STRIPES; s++) if (stripeHasItems[s]) activeStripes.push(s)
  if (!activeStripes.length) return { cols: [items], gutterMid: null }
  const needed = Math.ceil(activeStripes.length * FREE_STRIPE_RATIO)

  const lo = Math.floor(pageWidth * 0.25)
  const hi = Math.ceil(pageWidth * 0.75)
  const runs: { start: number; len: number }[] = []
  let runStart = -1
  for (let x = lo; x <= hi; x++) {
    let freeIn = 0
    for (const s of activeStripes) if (occupied[s]![x] === 0) freeIn++
    if (freeIn >= needed) {
      if (runStart < 0) runStart = x
    } else {
      if (runStart >= 0) runs.push({ start: runStart, len: x - runStart })
      runStart = -1
    }
  }
  if (runStart >= 0) runs.push({ start: runStart, len: hi - runStart + 1 })

  // Among wide-enough free runs, the gutter is the run whose INTERVAL is
  // nearest the page centre (usually the one containing it) — NOT the widest.
  // The widest run is often the whitespace between a column's number labels
  // and its own indented content (figures, tables), which would split
  // question numbers away from their bodies; and a narrow left column can
  // produce a huge free run whose midpoint sits far off-centre even though
  // the true gutter lies inside it.
  const candidates = runs.filter((r) => r.len >= profile.minGutterPt)
  if (!candidates.length) return { cols: [items], gutterMid: null }
  const centre = pageWidth / 2
  const intervalDist = (r: { start: number; len: number }) =>
    centre < r.start
      ? r.start - centre
      : centre > r.start + r.len
        ? centre - (r.start + r.len)
        : 0

  // Each qualifying run is TRIED as the gutter: split there, find anchors on
  // both sides, and prefer the split whose numbers read in order (right column
  // continues after the left). Centre distance and width only break ties —
  // an off-centre true gutter would otherwise lose to a centred whitespace
  // band inside the wider column, silently dropping that column's questions.
  const SPAN_MARGIN_PT = 4
  interface Scored {
    left: SegItem[]
    right: SegItem[]
    mid: number
    ordered: boolean
    dist: number
    len: number
  }
  const betterThan = (a: Scored, b: Scored) =>
    a.ordered !== b.ordered
      ? a.ordered
      : a.dist !== b.dist
        ? a.dist < b.dist
        : a.len > b.len
  let best: Scored | null = null
  for (const r of candidates) {
    const dist = intervalDist(r)
    const mid = dist === 0 ? centre : r.start + r.len / 2
    // An item straddling the gutter of a genuinely split page is page chrome
    // (section banner, full-width rule line): keep it out of both columns so
    // it can neither widen a column's bands nor pose as an anchor.
    const nonSpanning = items.filter(
      (it) => !(it.x < mid - SPAN_MARGIN_PT && it.x + it.w > mid + SPAN_MARGIN_PT),
    )
    const left = nonSpanning.filter((it) => it.x + it.w / 2 < mid)
    const right = nonSpanning.filter((it) => it.x + it.w / 2 >= mid)
    if (left.length < 3 || right.length < 3) continue
    const la = findAnchors(left, profile)
    const ra = findAnchors(right, profile)
    const ordered =
      la.length > 0 &&
      ra.length > 0 &&
      ra[0]!.number > la[la.length - 1]!.number
    const scored: Scored = { left, right, mid, ordered, dist, len: r.len }
    if (!best || betterThan(scored, best)) best = scored
  }
  if (!best) return { cols: [items], gutterMid: null }
  return { cols: [best.left, best.right], gutterMid: best.mid }
}

interface Anchor {
  number: number
  yTop: number
  x: number
}

// "12." / "12)" possibly fused with the stem's first word, or a standalone
// narrow "12" token. All must sit at the column's left margin.
function anchorNumber(it: SegItem): { n: number; fused: boolean } | null {
  const fused = it.str.match(/^\s*(\d{1,3})[.)](?:\s|$)/)
  if (fused) return { n: Number(fused[1]), fused: true }
  const bare = it.str.match(/^\s*(\d{1,3})\s*$/)
  if (bare && it.w < 24) return { n: Number(bare[1]), fused: false }
  return null
}

// Question labels align on a shared x within a couple of points; digits inside
// tables and figures sit at entirely different offsets. The indent gate is
// therefore anchored to the leftmost CLUSTER of candidate x-positions
// (preferring clusters that contain a fused "N." label) — measuring from the
// column's absolute left edge broke whenever any stray item (a figure caption)
// started a few points left of the labels and pushed a label out of the gate.
const X_CLUSTER_TOL_PT = 5

// A chain of 4+ anchors whose rows sit roughly one text line apart is a
// numbered LIST (answer-key table, instruction list, contents page), not
// questions — a real question needs vertical room for its options. Rejecting
// it lets the page fall through to the "no anchors" note instead of emitting
// fake crops.
const LIST_ROW_GAP_PT = 40

function isListChain(kept: Anchor[]): boolean {
  if (kept.length < 4) return false
  // The slice shifts by one, so `i` still addresses the preceding anchor, and
  // the length gate above leaves at least three gaps to take a median of.
  const gaps = kept
    .slice(1)
    .map((a, i) => a.yTop - kept[i]!.yTop)
    .sort((p, q) => p - q)
  return gaps[Math.floor(gaps.length / 2)]! < LIST_ROW_GAP_PT
}

function findAnchors(colItems: SegItem[], profile: SourceProfile): Anchor[] {
  if (!colItems.length) return []
  const all: (Anchor & { fused: boolean })[] = []
  for (const it of colItems) {
    const a = anchorNumber(it)
    if (a === null || a.n < 1 || a.n > profile.maxQuestionNumber) continue
    all.push({ number: a.n, yTop: it.yTop, x: it.x, fused: a.fused })
  }
  if (!all.length) return []

  const byX = [...all].sort((p, q) => p.x - q.x)
  const clusters: { minX: number; maxX: number; fused: boolean; count: number }[] =
    []
  for (const c of byX) {
    const last = clusters[clusters.length - 1]
    if (last && c.x - last.maxX <= X_CLUSTER_TOL_PT) {
      last.maxX = c.x
      last.fused ||= c.fused
      last.count++
    } else {
      clusters.push({ minX: c.x, maxX: c.x, fused: c.fused, count: 1 })
    }
  }

  // The gate deliberately has NO lower bound: ref is the x of an actual
  // candidate (so it can only sit at or right of the old column-edge
  // reference — anchors are gained, never lost), and bare-label books
  // survive a fused junk ref to their right only because everything left of
  // it is still admitted. A lone bare stray (a printed page number, one table
  // digit) must not become ref, hence the count >= 2 requirement for
  // non-fused clusters.
  const chainFrom = (ref: number): Anchor[] => {
    const candidates: Anchor[] = all.filter(
      (c) => c.x <= ref + profile.anchorIndentPt,
    )
    candidates.sort((p, q) => p.yTop - q.yTop)

    // Longest increasing chain (gap ≤ 2), not first-candidate greedy: a stray
    // "2." sitting above the real question 1 must lose to the 1..n run, not
    // poison it.
    // chainLen and prev are as long as `candidates`, every index below comes
    // from the loop bounds, and `bestEnd` is only read once it has been set to
    // a real position — so the assertions here restate what the loops enforce.
    const chainLen = candidates.map(() => 1)
    const prev = candidates.map(() => -1)
    let bestEnd = -1
    for (let i = 0; i < candidates.length; i++) {
      for (let j = 0; j < i; j++) {
        const step = candidates[i]!.number - candidates[j]!.number
        if (step >= 1 && step <= 2 && chainLen[j]! + 1 > chainLen[i]!) {
          chainLen[i] = chainLen[j]! + 1
          prev[i] = j
        }
      }
      if (bestEnd < 0 || chainLen[i]! > chainLen[bestEnd]!) bestEnd = i
    }
    if (bestEnd < 0) return []
    const kept: Anchor[] = []
    for (let i = bestEnd; i >= 0; i = prev[i]!) {
      kept.unshift(candidates[i]!)
      if (prev[i]! < 0) break
    }
    return isListChain(kept) ? [] : kept
  }

  // `all` is non-empty by the guard above, so the loop left at least one cluster.
  const primary =
    clusters.find((cl) => cl.fused || cl.count >= 2) ?? clusters[0]!
  let kept = chainFrom(primary.minX)

  // A degenerate result with other clusters available usually means the
  // reference was hijacked (a stray fused caption left of the real labels):
  // retry each fused cluster — then any cluster — and keep the longest chain.
  if (kept.length <= 1 && clusters.length > 1) {
    const fusedClusters = clusters.filter((cl) => cl.fused)
    for (const cl of fusedClusters.length ? fusedClusters : clusters) {
      const alt = chainFrom(cl.minX)
      if (alt.length > kept.length) kept = alt
    }
  }

  // A single bare digit with no fused label anywhere in the column is page
  // decoration (an ad page's phone number fragment), not a question.
  if (!all.some((c) => c.fused) && kept.length < 2) return []
  return kept
}

function buildBands(
  anchors: Anchor[],
  colItems: SegItem[],
  col: number,
  contentBottom: number,
  geo?: { left: number; right: number },
): Band[] {
  let colLeft = Math.min(...colItems.map((it) => it.x))
  let colRight = Math.max(...colItems.map((it) => it.x + it.w))
  // A partial text layer (answer options drawn as graphics) leaves the text
  // extent far narrower than the geometric column — widen the crop to the
  // column's share of the page so ink the text layer cannot see survives.
  if (geo && colRight - colLeft < 0.6 * (geo.right - geo.left)) {
    colLeft = Math.min(colLeft, geo.left)
    colRight = Math.max(colRight, geo.right)
  }
  // Body content above the first anchor (a shared passage, an instruction
  // block) belongs to question 1's crop — the header was already cut, so
  // whatever remains up there is real content that must not vanish.
  // Callers skip a column that produced no anchors, so there is always a first.
  const firstAnchor = anchors[0]!
  const aboveFirst = colItems.filter((it) => it.yTop < firstAnchor.yTop)
  const contentTop =
    (aboveFirst.length
      ? Math.min(...aboveFirst.map((it) => it.yTop))
      : firstAnchor.yTop) - 2
  const bands: Band[] = []
  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i]!
    const top = i === 0 ? contentTop : (anchors[i - 1]!.yTop + anchor.yTop) / 2
    const bottom =
      i === anchors.length - 1
        ? contentBottom
        : (anchor.yTop + anchors[i + 1]!.yTop) / 2
    const inside = colItems.filter(
      (it) => it.yTop >= top - 2 && it.yTop <= bottom + 2,
    )
    inside.sort((p, q) => p.yTop - q.yTop || p.x - q.x)
    bands.push({
      number: anchor.number,
      col,
      bbox: {
        x: colLeft - 4,
        y: top,
        w: colRight - colLeft + 8,
        h: bottom - top,
      },
      anchorYTop: anchor.yTop,
      textLayer: inside
        .map((it) => it.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    })
  }
  return bands
}

/**
 * The page's raw text items in top-left coordinates. Exposed for the
 * answer-key parser, which needs the same geometry the segmenter reads but
 * none of its question logic.
 */
export async function pageTextItems(page: PDFPageProxy): Promise<SegItem[]> {
  const viewport = page.getViewport({ scale: 1 })
  const content = await page.getTextContent()
  return itemsFromContent(content, viewport.height)
}

/**
 * The segmentation itself, over already-extracted text items. Split out from
 * `segmentPage` so the heuristics can be exercised without a PDF: the eval
 * harness feeds hand-written item layouts (two columns, a numbered list, a
 * missing gutter) and asserts the bands that come back.
 */
export function segmentItems(
  allItems: SegItem[],
  pageNumber: number,
  pageWidth: number,
  pageHeight: number,
  profile: SourceProfile = DEFAULT_PROFILE,
): PageSeg {
  const notes: string[] = []

  // Little to no text layer → scanned/image page. The AI scan path owns it.
  if (allItems.length < profile.minTextItems) {
    return {
      pageNumber,
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
  const { cols, gutterMid } = splitColumns(
    bodyItems,
    pageWidth,
    pageHeight,
    profile,
  )
  // Geometric column bounds: the left column's own left edge, mirrored for
  // the right column's outer edge (text-only margins can lie on pages whose
  // options are graphics, so each column also knows its share of the page).
  const col0 = cols[0]
  const col0Left = col0?.length ? Math.min(...col0.map((it) => it.x)) : 0
  cols.forEach((colItems, ci) => {
    if (!colItems.length) return
    const anchors = findAnchors(colItems, profile)
    if (!anchors.length) return
    const geo =
      gutterMid !== null
        ? ci === 0
          ? { left: col0Left, right: gutterMid }
          : { left: gutterMid, right: pageWidth - col0Left }
        : undefined
    bands.push(...buildBands(anchors, colItems, ci, contentBottom, geo))
  })

  bands.sort((p, q) => p.col - q.col || p.bbox.y - q.bbox.y)
  if (!bands.length) {
    notes.push('Sual ankeri tapılmadı — səhifə AI yolu ilə emal oluna bilər')
  }

  return {
    pageNumber,
    width: pageWidth,
    height: pageHeight,
    testNo: header.testNo,
    bands,
    notes,
    isScan: false,
  }
}

export async function segmentPage(
  page: PDFPageProxy,
  profile: SourceProfile = DEFAULT_PROFILE,
): Promise<PageSeg> {
  const viewport = page.getViewport({ scale: 1 })
  const content = await page.getTextContent()
  return segmentItems(
    itemsFromContent(content, viewport.height),
    page.pageNumber,
    viewport.width,
    viewport.height,
    profile,
  )
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

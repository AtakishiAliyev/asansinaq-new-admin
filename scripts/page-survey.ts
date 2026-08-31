// What the segmenter does to every page of every book we own.
//
//   npm run survey:pages                    every PDF in local/books/
//   npm run survey:pages -- a.pdf b.pdf     just these
//   npm run survey:pages -- --save          record the run as the baseline
//
// Free and offline: no model call, no network. It exists because "it still is
// not perfect" is not a number, and without a number every change to the
// segmenter is a guess and every regression is invisible until an operator
// happens to open the wrong page. Over 2,405 pages of eleven books this run
// takes a couple of minutes and costs nothing, so there is no reason to change
// the segmenter without it.
//
// It does NOT know the right answer — nobody has labelled these books. What it
// knows is what the pages of one book have in common, which is enough to find
// the pages that disagree with their own neighbours:
//
//   · a page whose question count is far off the book's dominant count
//   · a page whose numbering neither continues from the page before nor
//     restarts cleanly at the top of a section
//   · a band too short to hold a question
//
// Output goes to local/, gitignored, because the file names are commercial
// books.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { pageTextItems, segmentItems } from '@/core/segment/segmenter'

interface PageRow {
  n: number
  items: number
  isScan: boolean
  bands: number
  numbers: number[]
  /** Shortest band as a share of the page's median band. */
  minRatio: number | null
  /** Tallest band as a share of the median: a band that swallowed a question. */
  maxRatio: number | null
  flags: string[]
}

interface BookRow {
  name: string
  pages: number
  scan: number
  banded: number
  dominant: number
  suspect: number
  detail: PageRow[]
}

const BOOKS_DIR = 'local/books'
const OUT_DIR = 'local/survey'
const BASELINE = join(OUT_DIR, 'baseline.json')

const argv = process.argv.slice(2)
const save = argv.includes('--save')
const files = argv.filter((a) => !a.startsWith('--'))
const targets = files.length
  ? files
  : existsSync(BOOKS_DIR)
    ? readdirSync(BOOKS_DIR)
        .filter((f) => f.toLowerCase().endsWith('.pdf'))
        .map((f) => join(BOOKS_DIR, f))
    : []

if (!targets.length) {
  console.error(
    `Sənəd tapılmadı. PDF-ləri ${BOOKS_DIR}/ qovluğuna qoyun (gitignore-dadır)\n` +
      `və ya yolları arqument kimi verin:\n` +
      `  npm run survey:pages -- "/path/kitab.pdf"`,
  )
  process.exit(2)
}

/**
 * Does this page's numbering follow the last one?
 *
 * These books restart at 1 on every new test section, so a drop is not by
 * itself a defect — 1,212 of 1,271 banded pages "broke" a naive rising-number
 * rule, and almost all of them were honest section starts. What is not honest
 * is a page that neither continues nor restarts: 4,5,14,15 on one page, or a
 * jump into the middle of a range nothing led to.
 */
function numberingFlag(
  numbers: number[],
  previousMax: number,
  scannedSince: boolean,
): string | null {
  if (!numbers.length) return null
  const min = Math.min(...numbers)
  const max = Math.max(...numbers)
  // Its own numbers must climb: a page holding 4,5,14,15 is reading two
  // different things and calling them one page.
  const span = max - min + 1
  if (span > numbers.length * 2 + 2) return 'nömrələr dağınıq'
  if (!previousMax) return null
  if (min === previousMax + 1) return null // continues
  if (min <= 3) return null // restarts at a section
  if (min > previousMax + 1 && min <= previousMax + 3) return null // a page skipped
  // A scan page between the two holds the numbers that would have bridged
  // them, and nothing here can read it. The gap is the scan's, not the
  // segmenter's.
  if (scannedSince) return null
  return `nömrə sıçrayışı (${previousMax} → ${min})`
}

const report: BookRow[] = []

for (const file of targets) {
  const name = file.split('/').pop()!
  let doc: Awaited<ReturnType<typeof getDocument>['promise']>
  try {
    doc = await getDocument({
      data: new Uint8Array(readFileSync(file)),
      useSystemFonts: true,
    }).promise
  } catch (error) {
    console.error(`${name}: açılmadı — ${String(error).slice(0, 120)}`)
    continue
  }

  const detail: PageRow[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    try {
      const page = await doc.getPage(n)
      const viewport = page.getViewport({ scale: 1 })
      const items = await pageTextItems(page)
      const seg = segmentItems(items, n, viewport.width, viewport.height)
      const heights = seg.bands.map((b) => b.bbox.h).sort((a, b) => a - b)
      const median = heights.length ? heights[Math.floor(heights.length / 2)]! : 0
      detail.push({
        n,
        items: items.length,
        isScan: seg.isScan,
        bands: seg.bands.length,
        numbers: seg.bands.map((b) => b.number),
        minRatio: median > 0 ? Number((heights[0]! / median).toFixed(2)) : null,
        maxRatio:
          median > 0
            ? Number((heights[heights.length - 1]! / median).toFixed(2))
            : null,
        flags: [],
      })
    } catch (error) {
      detail.push({
        n,
        items: 0,
        isScan: false,
        bands: 0,
        numbers: [],
        minRatio: null,
        maxRatio: null,
        flags: [`xəta: ${String(error).slice(0, 60)}`],
      })
    }
  }
  await (doc as unknown as { destroy?: () => Promise<void> }).destroy?.()

  const banded = detail.filter((p) => p.bands > 0)
  const counts = new Map<number, number>()
  for (const p of banded) counts.set(p.bands, (counts.get(p.bands) ?? 0) + 1)
  const dominant =
    [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0

  let previousMax = 0
  let previousPage = 0
  for (const p of banded) {
    const scannedSince = detail.some(
      (q) => q.n > previousPage && q.n < p.n && q.isScan,
    )
    // Half the book's usual page is the line: a short last page of a section is
    // normal, a page that found two questions where every other found six is
    // not.
    if (dominant >= 4 && p.bands * 2 < dominant) p.flags.push(`az sual (${p.bands}/${dominant})`)
    const numbering = numberingFlag(p.numbers, previousMax, scannedSince)
    if (numbering) p.flags.push(numbering)
    if (p.minRatio !== null && p.minRatio < 0.25) p.flags.push(`nazik band (${p.minRatio})`)
    previousMax = Math.max(...p.numbers)
    previousPage = p.n
  }

  const suspect = banded.filter((p) => p.flags.length).length
  report.push({
    name,
    pages: doc.numPages,
    scan: detail.filter((p) => p.isScan).length,
    banded: banded.length,
    dominant,
    suspect,
    detail,
  })
}

const pad = (s: string | number, n: number) => String(s).padStart(n)
console.log(
  '\n' +
    'kitab'.padEnd(34) +
    pad('səh', 5) +
    pad('skan', 6) +
    pad('bandlı', 8) +
    pad('sual/səh', 10) +
    pad('şübhəli', 9),
)
console.log('─'.repeat(72))
for (const b of report) {
  console.log(
    b.name.slice(0, 33).padEnd(34) +
      pad(b.pages, 5) +
      pad(b.scan, 6) +
      pad(b.banded, 8) +
      pad(b.dominant || '—', 10) +
      pad(b.suspect, 9),
  )
}

const totals = report.reduce(
  (a, b) => ({
    pages: a.pages + b.pages,
    scan: a.scan + b.scan,
    banded: a.banded + b.banded,
    suspect: a.suspect + b.suspect,
  }),
  { pages: 0, scan: 0, banded: 0, suspect: 0 },
)
const clean = totals.banded - totals.suspect
console.log('─'.repeat(72))
console.log(
  `CƏMİ ${totals.pages} səhifə · ${totals.scan} skan yolu · ${totals.banded} bandlı` +
    ` · ${clean} təmiz (${totals.banded ? Math.round((clean / totals.banded) * 100) : 0}%)` +
    ` · ${totals.suspect} şübhəli`,
)

for (const b of report.filter((x) => x.suspect)) {
  const flagged = b.detail.filter((p) => p.flags.length).slice(0, 8)
  console.log(`\n${b.name}`)
  for (const p of flagged) {
    console.log(`   s.${pad(p.n, 3)}  [${p.numbers.join(',')}]  ${p.flags.join(' · ')}`)
  }
  if (b.suspect > flagged.length) console.log(`   … və daha ${b.suspect - flagged.length} səhifə`)
}

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(join(OUT_DIR, 'last.json'), JSON.stringify(report, null, 1))

if (save) {
  writeFileSync(BASELINE, JSON.stringify(report, null, 1))
  console.log(`\nbaza yazıldı: ${BASELINE}`)
} else if (existsSync(BASELINE)) {
  const before: BookRow[] = JSON.parse(readFileSync(BASELINE, 'utf8'))
  const changes: string[] = []
  for (const now of report) {
    const then = before.find((x) => x.name === now.name)
    if (!then) continue
    for (const p of now.detail) {
      const q = then.detail.find((x) => x.n === p.n)
      if (!q) continue
      if (p.numbers.join(',') !== q.numbers.join(',')) {
        changes.push(`${now.name} s.${p.n}: [${q.numbers}] → [${p.numbers}]`)
      }
    }
  }
  console.log(
    changes.length
      ? `\nBAZADAN FƏRQ (${changes.length}):\n  ` + changes.slice(0, 30).join('\n  ')
      : '\nBazadan fərq yoxdur.',
  )
}

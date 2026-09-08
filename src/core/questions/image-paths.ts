// Where a question's cut pictures live in the `question-crops` bucket.
//
// One convention, written once: the worker stores here after a batch, the
// review screen stores here after a re-run, and the renderers read from here.
// A second copy of the pattern in the browser was one character away from a
// row pointing at a picture that was never stored.

/** The row fields a path depends on. Structural, so a test can pass a slice. */
export interface PathRow {
  book_id: number
  page_number: number
  col: number
  q_no: number
}

const stem = (row: PathRow): string =>
  `${row.book_id}/p${row.page_number}_c${row.col}_q${row.q_no}`

/** A picture option, by its letter. */
export function optionImagePath(row: PathRow, label: string): string {
  return `${stem(row)}_opt${label}.png`
}

/** A figure cut from the crop, by its index in the document. */
export function figureImagePath(row: PathRow, index: number): string {
  return `${stem(row)}_fig${index}.png`
}

/** The row fields that can name a stored object. Structural and loose on
 *  purpose: the worker's row, the browser's row and a script's select all
 *  differ in what else they carry. */
export interface StoredRow {
  crop_path?: string | null
  options?: unknown
  figures?: unknown
  prev_version?: unknown
}

const isStored = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && !v.startsWith('data:')

function pathsIn(options: unknown, figures: unknown, into: Set<string>): void {
  if (Array.isArray(options)) {
    for (const o of options) {
      const image = (o as { image?: unknown } | null)?.image
      if (isStored(image)) into.add(image)
    }
  }
  const items = (figures as { items?: unknown } | null)?.items
  if (Array.isArray(items)) {
    for (const it of items) {
      const fig = it as { kind?: unknown; src?: unknown; genSrc?: unknown }
      if (fig.kind !== 'image') continue
      if (isStored(fig.src)) into.add(fig.src)
      if (isStored(fig.genSrc)) into.add(fig.genSrc)
    }
  }
}

/**
 * Every object in `question-crops` that this row still needs.
 *
 * The parked version counts. A repair round parks what it replaces in
 * `prev_version`, and a repair that scores worse is rolled BACK to it — so the
 * pictures a parked version names are live for exactly as long as the parking
 * lasts, and a cleanup that read only the current figures would delete the
 * drawing a rollback was about to restore.
 */
export function storedPathsOf(row: StoredRow): string[] {
  const out = new Set<string>()
  if (isStored(row.crop_path)) out.add(row.crop_path)
  pathsIn(row.options, row.figures, out)
  const parked = row.prev_version as { options?: unknown; figures?: unknown } | null
  if (parked && typeof parked === 'object') pathsIn(parked.options, parked.figures, out)
  return [...out]
}

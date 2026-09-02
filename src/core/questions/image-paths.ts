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

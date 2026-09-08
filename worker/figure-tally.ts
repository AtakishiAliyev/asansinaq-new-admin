import type { QuestionRow } from './db.ts'
import { log } from './log.ts'

/**
 * How many figures came back as each FigSpec kind, per book.
 *
 * `image` is the kind the model reaches for when no structured kind holds the
 * drawing, and the kind every figure is rerouted to on a `gen` book. A cut
 * book where everything lands there is one where the vector lane is not
 * working, and there is no other signal for that — the questions all look
 * structured.
 */
const figureKindTally = new Map<number, Map<string, number>>()

export function noteFigureKinds(
  row: QuestionRow,
  wire: Record<string, unknown>,
): void {
  const figures = Array.isArray(wire.figures) ? wire.figures : []
  const byBook = figureKindTally.get(row.book_id) ?? new Map<string, number>()
  const kinds = figures.length
    ? figures.map((f) => String((f as { kind?: unknown }).kind ?? 'unknown'))
    : ['(none)']
  for (const kind of kinds) byBook.set(kind, (byBook.get(kind) ?? 0) + 1)
  figureKindTally.set(row.book_id, byBook)
}

export function reportFigureKinds(): void {
  for (const [bookId, kinds] of figureKindTally) {
    const total = [...kinds.values()].reduce((a, b) => a + b, 0)
    const cut = kinds.get('image') ?? 0
    const drawn = total - (kinds.get('(none)') ?? 0)
    const parts = [...kinds.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([kind, n]) => `${kind}=${n}`)
    log(
      `book ${bookId} figures: ${parts.join(' ')}` +
        (drawn
          ? ` — structured ${drawn - cut}/${drawn}, cut ${cut}/${drawn}`
          : ''),
    )
  }
  figureKindTally.clear()
}

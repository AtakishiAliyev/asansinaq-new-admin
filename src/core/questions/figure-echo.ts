// The stack the model drew AND then typed out again.
//
// Rule 14 was tightened to say that an alt-alta operation is a figure and must
// not be written into the stem as lines. The model now does both: the figure
// comes back correct and the same rows are repeated above the question, so the
// reader sees the operation twice — once set as the book sets it, once as a
// column of stray fragments.
//
// It is settled here rather than by asking the prompt again, because it can be
// settled exactly. The figure holds those cells; a stem line that reproduces
// one carries nothing the row does not already show, and removing it cannot
// lose content. That is the same ground `fixLeakedNewlines` stands on, and the
// opposite of inventing anything: nothing is written, only a duplicate dropped.
//
// A prompt rule would also cost a PROMPT_VERSION bump, which re-prices every
// cached read in the bank to save a handful of output tokens per question.
//
// Pure, and in core, because the worker normalises the wire and an eval pins
// the behaviour.
import type { FigItem } from '@/core/figures/figspec'

/**
 * A cell as it can be compared across the two places it appears.
 *
 * The stem writes `$4\ 5\ B$` where the figure holds `4\ 5\ B`, and the
 * operator row is `$+\ ba$` against a bare `ba`, so the maths delimiters, the
 * spacing commands, the braces and a leading operator all have to come off
 * before the two can be recognised as one thing. Case does NOT: `B` and `b`
 * are different digits in these puzzles.
 */
function canon(text: string): string {
  return text
    .replace(/\$+/g, '')
    .replace(/\\(?:overline|mathrm|text|quad|qquad)\b/g, '')
    .replace(/\\[,;!: ]/g, '')
    .replace(/[{}\\]/g, '')
    .replace(/^\s*[+\-−×÷*]/, '')
    .replace(/\s+/g, '')
}

/** Every cell a typeset arithmetic figure prints, in no particular order. */
function cellsOf(item: FigItem): string[] {
  if (item.kind === 'vertical_arithmetic') {
    return [...(item.rows ?? []).map((r) => r.tex), item.resultTex].filter(
      (t): t is string => typeof t === 'string' && t.length > 0,
    )
  }
  if (item.kind === 'division_scheme') {
    return [
      item.dividendTex,
      item.divisorTex,
      item.quotientTex,
      item.remainderTex,
      ...(item.steps ?? []).map((s) => s.tex),
    ].filter((t): t is string => typeof t === 'string' && t.length > 0)
  }
  return []
}

/**
 * The stem with any run of lines that merely repeats a figure removed.
 *
 * A RUN of at least two, and that floor is the whole safety margin: a stem
 * legitimately names one of the figure's values on a line of its own ("725"
 * as the premise of the sentence under it), and gutting that would lose
 * wording the book prints. Two consecutive lines that are both bare figure
 * cells are not prose in any book seen — they are the stack, typed again.
 */
export function stripFigureEcho(stem: string, items: readonly FigItem[]): string {
  const cells = new Set(items.flatMap(cellsOf).map(canon))
  cells.delete('')
  if (!cells.size) return stem

  const lines = stem.split('\n')
  const echo = lines.map((line) => {
    const key = canon(line)
    return key.length > 0 && cells.has(key)
  })

  const keep: string[] = []
  for (let i = 0; i < lines.length; i++) {
    if (!echo[i]) {
      keep.push(lines[i]!)
      continue
    }
    let end = i
    while (end + 1 < lines.length && echo[end + 1]) end++
    // A lone echo stays: it may be the sentence's own subject.
    if (end === i) keep.push(lines[i]!)
    i = end
  }
  // Collapse the blank gap a removed run leaves between two paragraphs.
  return keep
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '')
}

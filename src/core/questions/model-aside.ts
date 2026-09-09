// The line the model wrote for itself.
//
// Seventeen of one run's 150 questions ended with a line the book does not
// print: `⇒ BA = ?`, `⇒ Toplam = ?`, `⇒ Cevap = ?`, `$\Rightarrow$ A sayısının
// son basamağı = ?`. It is the model restating what the question asks before
// answering it — reasoning it does not need to write down, and which the
// student then reads as part of the question.
//
// Measured against the book's own text layer, not assumed: thirteen of them
// appear nowhere in it, and the other four are the question sentence repeated
// with an arrow bolted on. Across the whole run there was no stem line
// beginning with an implication arrow that the book had actually printed.
//
// It is dropped rather than flagged, for the same reason a repeated figure is
// (`figure-echo.ts`): the check is exact and the alternative costs a paid
// re-read to remove a line we can already identify. What is dropped is only
// ever a whole trailing line whose first mark is an arrow, and never the last
// thing left — a stem is not emptied on the strength of one character.
//
// Pure, and in core, because the worker normalises the wire and an eval pins
// the behaviour.

/**
 * An implication arrow, in every spelling that reaches a stem.
 *
 * The Unicode marks and the TeX commands both appear in live rows — one of the
 * seventeen wrote `$\Rightarrow$` — so a rule that knows only about `⇒` misses
 * the ones that came back as maths.
 */
const LEADING_ARROW =
  /^\s*\$?\s*(?:[⇒⟹→⟶➔➜]|\\(?:R|r|L|l)(?:ight|ong)?arrow\b|\\implies\b|\\to\b|\\Rarr\b)/

/**
 * The stem with a trailing arrow line removed.
 *
 * Only the LAST line, and only when something is left behind. A book does
 * print an implication inside a chain of working — `a=2 ⇒ b=3` — but such a
 * line is followed by the sentence that asks the question, so it is never the
 * last one. Restricting to the tail is what separates the model's summary from
 * the page's own algebra.
 */
export function stripModelAside(stem: string): string {
  const lines = stem.split('\n')
  let last = lines.length - 1
  while (last >= 0 && lines[last]!.trim() === '') last--
  if (last < 0) return stem
  if (!LEADING_ARROW.test(lines[last]!)) return stem
  // Never the only thing left: an arrow is not grounds for emptying a stem.
  const rest = lines.slice(0, last).filter((l) => l.trim() !== '')
  if (!rest.length) return stem
  return lines
    .slice(0, last)
    .join('\n')
    .replace(/\n+$/g, '')
}

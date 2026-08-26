// Do the sets in the stem and the sets in the venn agree?
//
// The set-theory twin of `figure-refs`, and it exists for the same reason: a
// figure can be internally perfect and still not be the figure the question
// asks about. One live row came back as a venn of two circles named B and C
// while the stem asked for A\(B∪C) — set A was simply absent, so the diagram
// could not answer its own question. It rendered cleanly, it passed every
// venn check, and only reading the stem beside it showed the hole.
//
// Deterministic and free: the set names in these questions are single capital
// letters, and they appear in the stem in a small number of shapes.
import type { FigureDoc, VennFig } from '@/core/figures/figspec'

/**
 * Set names the stem actually talks about.
 *
 * Deliberately narrow. A capital letter is only counted when it appears in a
 * SET context — beside an operator, in a set-builder, or as the subject of a
 * cardinality — because these stems are full of capitals that are not sets:
 * points, constants, answer labels, and the question number itself.
 */
export function stemSetNames(stem: string): Set<string> {
  const found = new Set<string>()

  // Each capital is judged by its NEIGHBOURHOOD rather than by matching pairs.
  // Pair matching loses every third set: in "A\\(B∪C)" the B is consumed as the
  // second half of the A-B pair, so it cannot start the B-C pair and C is never
  // seen — which is exactly the set that was missing from the live row this
  // check exists for.
  const OPERATOR = /(?:∩|∪|∖|\\cap|\\cup|\\setminus|\\backslash|\\\\|\\|-|\/)/
  const CARDINALITY = /(?:\b[sn]\s*$|\|\s*$)/
  const SET_BUILDER = /^\s*=\s*\\?\{/
  const COMPLEMENT = /^\s*['’]/

  for (const m of stem.matchAll(/[A-Z]/g)) {
    const at = m.index ?? 0
    // A capital glued to other letters is a word, not a set name.
    const prevChar = stem[at - 1] ?? ''
    const nextChar = stem[at + 1] ?? ''
    if (/[A-Za-zÇĞİÖŞÜçğıöşü]/.test(prevChar) || /[A-Za-zÇĞİÖŞÜçğıöşü]/.test(nextChar)) continue

    const before = stem.slice(Math.max(0, at - 14), at)
    const after = stem.slice(at + 1, at + 15)

    if (
      OPERATOR.test(before.replace(/[\s(]+$/, '').slice(-12)) ||
      OPERATOR.test(after.replace(/^[\s)]+/, '').slice(0, 12)) ||
      CARDINALITY.test(before.replace(/[\s(]+$/, '')) ||
      SET_BUILDER.test(after) ||
      COMPLEMENT.test(after)
    ) {
      found.add(m[0])
    }
  }
  return found
}

export interface SetRefProblem {
  code: 'venn_missing_set' | 'venn_extra_set'
  message: string
}

export function setRefProblems(doc: FigureDoc, stem: string): SetRefProblem[] {
  const venns = doc.items.filter((i): i is VennFig => i.kind === 'venn')
  if (!venns.length) return []

  const declared = new Set(venns.flatMap((v) => v.shapes.map((s) => s.id)))
  const used = stemSetNames(stem)
  // Nothing recognisable in the stem is not evidence of anything: plenty of
  // these questions carry their sets only in the picture ("Taralı alan = ?").
  if (!used.size) return []

  const problems: SetRefProblem[] = []
  const missing = [...used].filter((id) => !declared.has(id)).sort()
  if (missing.length) {
    problems.push({
      code: 'venn_missing_set',
      message:
        `Sual ${missing.join(', ')} çoxluğundan danışır, amma Venn diaqramında belə çoxluq yoxdur — ` +
        'diaqram öz sualına cavab verə bilmir',
    })
  }

  // The other direction is a warning, not an error: a diagram may legitimately
  // draw a set the stem never names, and saying so is worth a look rather than
  // a block.
  const extra = [...declared].filter((id) => /^[A-Z]$/.test(id) && !used.has(id)).sort()
  if (extra.length && missing.length) {
    problems.push({
      code: 'venn_extra_set',
      message: `Diaqramda sualda işlənməyən çoxluq var: ${extra.join(', ')}`,
    })
  }
  return problems
}

// Which figures a structured kind is actually allowed to claim.
//
// The DSL kinds are worth having because they can be linted, edited and
// compared. That value is entirely conditional on the kind FITTING the figure:
// a venn drawn out of triangles, or a curve whose unknown coefficient the model
// filled in with a decimal it made up, is worse than no structured figure at
// all — it renders confidently, reads as a real extraction, and is wrong in a
// way that only shows up next to the original.
//
// Every rule below is a real failure from one live page, not a precaution:
//
//   q307/7   set ids were "A\B" and "A\C" — the OPERATION was inside the name,
//            and eight venn_unknown_set errors followed from one bad shape list
//   q307/8   shapes were circle + rect + rect
//   q307/11  shapes were triangle + circle + circle
//   q371/8   the stem said f(x) = ax^3 with `a` UNKNOWN, and the curve came
//            back as x*x*x*0.335 — a fabricated constant, rendered as fact
//   q365/12  two splines through eyeballed points, standing in for a function
//            the question never gives
//
// Anything a kind cannot hold belongs in `kind=image`: a cleaned cut of the
// original, which cannot be wrong about what the page shows.
import type { FigItem } from '@/core/figures/figspec'

export interface Ineligible {
  /** Which kind over-reached. */
  kind: string
  /** What made it ineligible, in the reviewer's language. */
  reason: string
}

/** A plain set name: one capital letter, nothing else. */
const PLAIN_SET_ID = /^[A-Z]$/

/**
 * Characters that mean the id is an EXPRESSION wearing a name.
 *
 * `A\B` as a shape id is not a set the diagram draws, it is an operation over
 * two sets it does not draw — so every region expression that mentions it
 * refers to something the renderer was never given.
 */
const OPERATOR_IN_NAME = /[\\/∪∩\-+()'’ ]/

export function figureIneligible(item: FigItem): Ineligible | null {
  if (item.kind === 'venn') {
    const shapes = item.shapes ?? []
    const nonCircle = shapes.filter((s) => s.geom?.type !== 'circle')
    if (nonCircle.length) {
      return {
        kind: 'venn',
        reason:
          `${nonCircle.map((s) => `${s.id}:${s.geom?.type}`).join(', ')} — ` +
          'venn yalnız DAİRƏLƏR üçündür; başqa formalar kəsişmə həndəsəsini dəyişir',
      }
    }
    const named = shapes.filter((s) => !PLAIN_SET_ID.test(s.id) || OPERATOR_IN_NAME.test(s.id))
    if (named.length) {
      return {
        kind: 'venn',
        reason:
          `çoxluq adları: ${named.map((s) => `"${s.id}"`).join(', ')} — ` +
          'ad tək böyük hərf olmalıdır; "A\\B" kimi ad çəkilməyən çoxluq üzərində əməliyyatdır',
      }
    }
  }

  if (item.kind === 'function_graph') {
    for (const panel of item.panels ?? []) {
      for (const curve of panel.curves ?? []) {
        if (curve.def?.type === 'spline') {
          return {
            kind: 'function_graph',
            reason:
              `"${curve.id}" spline ilə verilib — spline gözlə seçilmiş nöqtələrdən ` +
              'keçən təxmindir, düsturu bilinməyən əyri üçün istifadə olunur',
          }
        }
      }
    }
  }
  return null
}

/**
 * Every ineligible item in a document.
 *
 * Returned rather than thrown: the caller decides whether this is a flag on a
 * row or a refusal, and a figure being wrong is never a reason to lose the rest
 * of the question.
 */
export function documentIneligible(items: FigItem[]): Ineligible[] {
  return items.map(figureIneligible).filter((x): x is Ineligible => x !== null)
}

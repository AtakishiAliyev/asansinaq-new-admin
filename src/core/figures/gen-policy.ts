// Which cut figures the reproduction lane may redraw at all.
//
// The lane exists because a 1:1 redraw reads better than a scan. On a set
// diagram it also reads better when it is WRONG: two reviewed rows on one
// live page — p307/11 and p308/13 — came back with a region shaded that the
// page leaves white, and a region left white that the page shades. On one of
// them the structural guard passed the drawing; on both the verification wave
// passed it with an empty diff. A cleaner-looking figure that answers a
// different question is the whole risk of the lane, and on these questions the
// shading IS the answer, so the redraw has nothing to offer against it.
//
// So the lane declines up front, deterministically, rather than trusting two
// probabilistic checks to catch what a redraw changed. The cut is the source's
// own pixels, cleaned of the watermark, and cannot be wrong about the page.
//
// Three signals, any one enough. The cut began life as a `venn` — the model
// read a set diagram and the lane rerouted it. The stem asks about the shaded
// region in the words these books use for it. Or the question is written in
// set notation at all: on one live page of sixteen, five set diagrams reached
// the lane because the model had read them straight to `image` (the shapes
// were not circles) and the stem — printed once above the group, or just an
// expression — never said "taralı". Their options did: `A - B`, `(A∩B)'∩C`,
// `C-(A∪B)`. A diagram beside set expressions is a set diagram.
import type { ImageFig } from '@/core/figures/figspec'

/**
 * The words a stem uses when the shaded region is the question. Turkish
 * ("taralı"), the Azerbaijani spellings ("ştrixlənmiş", "boyalı", "rənglənmiş")
 * and the noun forms that follow them.
 */
const ASKS_ABOUT_SHADING = /taral[ıi]|taranm[ıi]ş|ştrix|boyal[ıi]|boyanm[ıi]ş|rənglənmiş|rəngli\s+(bölgə|sahə|hissə)/i

/**
 * Set algebra, as it reaches us: the Unicode operators, their TeX spellings,
 * and the words for "set" and "element" in both languages.
 */
const SET_NOTATION = /∩|∪|\\cap\b|\\cup\b|\\setminus\b|\\backslash\b|\\varnothing|\\emptyset|küme|çoxluq|\beleman/i

/** What the policy reads: the stem and the option texts. */
export interface PolicyQuestion {
  stem: string
  options: { tex?: string }[]
}

export type ReproductionDecision = { allowed: true } | { allowed: false; reason: string }

export function reproductionPolicy(question: PolicyQuestion, item: ImageFig): ReproductionDecision {
  if (item.origin === 'venn') {
    return {
      allowed: false,
      reason:
        'Çoxluq diaqramıdır — boyalı bölgə sualın özüdür və təkrar çəkiliş onu dəyişə bilər; ' +
        'təmizlənmiş kəsim göstərilir',
    }
  }
  if (ASKS_ABOUT_SHADING.test(question.stem)) {
    return {
      allowed: false,
      reason:
        'Sual boyalı bölgəni soruşur — təkrar çəkiliş bölgəni dəyişə bilər; ' +
        'təmizlənmiş kəsim göstərilir',
    }
  }
  const text = [question.stem, ...question.options.map((o) => o.tex ?? '')].join('\n')
  if (SET_NOTATION.test(text)) {
    return {
      allowed: false,
      reason:
        'Sual çoxluq ifadələri ilə yazılıb — diaqramın bölgələri cavabın özüdür və təkrar çəkiliş ' +
        'onları dəyişə bilər; təmizlənmiş kəsim göstərilir',
    }
  }
  return { allowed: true }
}

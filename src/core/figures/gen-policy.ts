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
// Two signals, either one enough. The cut began life as a `venn` — the model
// read a set diagram and the lane rerouted it — or the stem asks about the
// shaded region in the words these books use for it.
import type { ImageFig } from '@/core/figures/figspec'

/**
 * The words a stem uses when the shaded region is the question. Turkish
 * ("taralı"), the Azerbaijani spellings ("ştrixlənmiş", "boyalı", "rənglənmiş")
 * and the noun forms that follow them.
 */
const ASKS_ABOUT_SHADING = /taral[ıi]|taranm[ıi]ş|ştrix|boyal[ıi]|boyanm[ıi]ş|rənglənmiş|rəngli\s+(bölgə|sahə|hissə)/i

export type ReproductionDecision = { allowed: true } | { allowed: false; reason: string }

export function reproductionPolicy(stem: string, item: ImageFig): ReproductionDecision {
  if (item.origin === 'venn') {
    return {
      allowed: false,
      reason:
        'Çoxluq diaqramıdır — boyalı bölgə sualın özüdür və təkrar çəkiliş onu dəyişə bilər; ' +
        'təmizlənmiş kəsim göstərilir',
    }
  }
  if (ASKS_ABOUT_SHADING.test(stem)) {
    return {
      allowed: false,
      reason:
        'Sual boyalı bölgəni soruşur — təkrar çəkiliş bölgəni dəyişə bilər; ' +
        'təmizlənmiş kəsim göstərilir',
    }
  }
  return { allowed: true }
}

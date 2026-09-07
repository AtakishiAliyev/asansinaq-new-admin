import {
  describeFigure,
  type VerifyInput,
} from '@/core/extract/verify-request'
import type { ExtractedQuestion } from '@/core/questions/extraction'
import { renderQuestion } from './render-question.ts'

// What the verifier is SHOWN, separated from the request that carries it and
// from the row it came out of.
//
// It lives in its own module, and deliberately depends on no configuration, so
// that anything wanting to exercise this wave can assemble exactly what the
// wave assembles. `scripts/verify-smoke.ts` used to build its own evidence and
// left out the enlarged figure pairs — so the harness that exists to prove the
// wave catches figure corruptions was testing it on strictly weaker evidence
// than production, and a change that broke the pairs in production would not
// have moved a single number in the harness.
//
// The config-free part is not incidental: the harness reads its own `.env` and
// must keep running without the worker's whole environment exported.

/** `data:<mime>;base64,<bytes>` → the request's image shape, or null. */
function splitDataUri(
  uri: string | undefined,
): { image: string; mime: 'image/png' | 'image/jpeg' } | null {
  const m = uri?.match(/^data:(image\/(?:png|jpeg));base64,(.+)$/)
  if (!m) return null
  return { mime: m[1] as 'image/png' | 'image/jpeg', image: m[2]! }
}

export function verificationEvidence(
  crop: { image: string; mime: 'image/png' | 'image/jpeg' },
  question: ExtractedQuestion,
  images: Map<string, string>,
): VerifyInput {
  const rendered = renderQuestion(question, images)
  // Every reproduced figure beside its cut, at full size, for the shading
  // comparison the whole-page render is too small for.
  const figurePairs = (question.figures?.items ?? []).flatMap((item) => {
    if (item.kind !== 'image' || !item.genSrc) return []
    const cut = splitDataUri(images.get(item.src))
    const reproduction = splitDataUri(images.get(item.genSrc))
    return cut && reproduction ? [{ cut, reproduction }] : []
  })
  return {
    original: crop,
    recreation: { image: rendered.png.toString('base64') },
    figureClaims: describeFigure(question.figures),
    ...(figurePairs.length ? { figurePairs } : {}),
  }
}

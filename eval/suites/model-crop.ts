// What a model is shown versus what a cutter reads.
//
// Crops are rendered large so the pictures cut out of them are crisp; the
// model gets a copy shrunk to the width it always read at. The one invariant
// worth a suite: a crop already at that width is sent UNCHANGED, or every row
// read before the resolution went up would stop hitting its cache.
import { MODEL_CROP_MAX_WIDTH, modelCropSize } from '@/core/segment/model-crop'
import { CROP_RENDER_SCALE } from '@/core/segment/crop'
import { deepEq, eq, ok, suite } from '../harness.ts'

export const modelCropSuite = suite('model-crop', {
  'a crop at the model width is sent as it is'() {
    eq(modelCropSize(790, 661), null, 'the size every existing crop has')
    eq(modelCropSize(MODEL_CROP_MAX_WIDTH, 500), null, 'the boundary is inclusive')
  },

  'a larger crop is shrunk to the model width, keeping its shape'() {
    deepEq(modelCropSize(1600, 1200), { width: 800, height: 600 })
    deepEq(modelCropSize(1449, 1212), { width: 800, height: 669 }, 'rounded, not truncated')
    ok((modelCropSize(4000, 1)?.height ?? 0) >= 1, 'never a zero-height image')
  },

  // A4 at the render scale must fit under the canvas cap, or the cap silently
  // decides the scale and the resolution this exists to raise is not raised.
  'an A4 page renders under the canvas area cap at the crop scale'() {
    const area = 595 * 842 * CROP_RENDER_SCALE ** 2
    ok(area <= 16_000_000, `A4 at ${CROP_RENDER_SCALE}x is ${Math.round(area / 1e6)}M px`)
    ok(CROP_RENDER_SCALE > 3, 'and it is larger than the 3x that read as a soft scan')
  },
})

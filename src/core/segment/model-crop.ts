// How big a crop is when a MODEL reads it, as opposed to when a cutter does.
//
// Crops are rendered from the page at CROP_RENDER_SCALE so that the pictures
// cut out of them — option images, figure cuts — are crisp. The model does not
// need that: it read ~800px crops fine, image tokens grow with the pixel count,
// and the provider resizes anything past ~1568px on the long edge anyway. So
// the stored crop is the source of truth for cutting, and a copy shrunk to
// this width is what goes into the request.
//
// The width is the one the pipeline ran at before crops were rendered larger,
// which keeps two things exactly as they were: the model sees the picture it
// was tuned on, and a crop that is already this size is sent byte for byte,
// so the cache keys of every row read so far still hit.
//
// Pure: the sizing decision is here so the worker (napi canvas) and the review
// screen (DOM canvas) shrink to the same dimensions, and the eval can pin it.

export const MODEL_CROP_MAX_WIDTH = 800

/**
 * The size to shrink a crop to before a model reads it, or null when the crop
 * is already small enough and must be sent unchanged.
 */
export function modelCropSize(
  width: number,
  height: number,
): { width: number; height: number } | null {
  if (width <= MODEL_CROP_MAX_WIDTH) return null
  const scale = MODEL_CROP_MAX_WIDTH / width
  return {
    width: MODEL_CROP_MAX_WIDTH,
    height: Math.max(1, Math.round(height * scale)),
  }
}

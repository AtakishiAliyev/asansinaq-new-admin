// The model-facing copy of a stored crop. See core/segment/model-crop.ts for
// the sizing rule; this is only the canvas that applies it.
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { modelCropSize } from '@/core/segment/model-crop'

export interface CropImage {
  image: string
  mime: 'image/png' | 'image/jpeg'
}

/**
 * The crop as the model should see it.
 *
 * Returns the SAME object when no shrinking is needed, so a crop already at
 * the model width is sent byte for byte and its cache key is unchanged. A crop
 * that cannot be decoded is also sent as it is: the request will fail loudly
 * there, which beats failing quietly here.
 */
export async function shrinkForModel(crop: CropImage): Promise<CropImage> {
  let img
  try {
    img = await loadImage(Buffer.from(crop.image, 'base64'))
  } catch {
    return crop
  }
  const target = modelCropSize(img.width, img.height)
  if (!target) return crop
  const canvas = createCanvas(target.width, target.height)
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, target.width, target.height)
  ctx.drawImage(img, 0, 0, target.width, target.height)
  return { image: canvas.toBuffer('image/png').toString('base64'), mime: 'image/png' }
}

// Canvas helpers for the structuring flow (browser-side by design).

export function splitDataUrl(dataUrl: string): {
  image: string
  mime: 'image/png' | 'image/jpeg'
} {
  const m = dataUrl.match(/^data:(image\/(?:png|jpeg));base64,(.*)$/)
  if (!m) throw new Error('yanlış dataUrl')
  return { mime: m[1] as 'image/png' | 'image/jpeg', image: m[2]! }
}

/** Cut a 0-1000-normalized [ymin,xmin,ymax,xmax] region out of an image. */
export async function cropRegion(
  dataUrl: string,
  box: [number, number, number, number],
): Promise<string> {
  const img = new Image()
  img.src = dataUrl
  await img.decode()
  const [ymin, xmin, ymax, xmax] = box
  const sx = (xmin / 1000) * img.naturalWidth
  const sy = (ymin / 1000) * img.naturalHeight
  const sw = Math.max(1, ((xmax - xmin) / 1000) * img.naturalWidth)
  const sh = Math.max(1, ((ymax - ymin) / 1000) * img.naturalHeight)
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(sw)
  canvas.height = Math.ceil(sh)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context alınmadı')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
  return canvas.toDataURL('image/png')
}

/**
 * Caps an image so it can be sent alongside others.
 *
 * A conversation carrying several images is held to 2000 pixels per side, and
 * an agent run carries a dozen — so an enlarged region silently became a 400
 * that killed the run nine turns in. Enlarging past this point buys nothing
 * anyway: an image costs the same tokens whatever its resolution, and detail
 * beyond the cap is discarded on the way in.
 */
const MAX_SIDE = 1500

export async function fitForModel(dataUrl: string): Promise<string> {
  const img = new Image()
  img.src = dataUrl
  await img.decode()
  const longest = Math.max(img.naturalWidth, img.naturalHeight)
  if (longest <= MAX_SIDE) return dataUrl
  const scale = MAX_SIDE / longest
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context alınmadı')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/png')
}

// Canvas helpers for the structuring flow (browser-side by design).

export function splitDataUrl(dataUrl: string): {
  image: string
  mime: 'image/png' | 'image/jpeg'
} {
  const m = dataUrl.match(/^data:(image\/(?:png|jpeg));base64,(.*)$/)
  if (!m) throw new Error('yanlış dataUrl')
  return { mime: m[1] as 'image/png' | 'image/jpeg', image: m[2]! }
}


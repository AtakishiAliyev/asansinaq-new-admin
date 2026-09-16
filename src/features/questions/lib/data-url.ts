/** A canvas data URL as the bytes and type the bucket wants. */
export function dataUrlToBlob(dataUrl: string): { blob: Blob; mime: string } {
  const m = dataUrl.match(/^data:([^;]+);base64,(.*)$/)
  if (!m) throw new Error('yanlış dataUrl')
  // A match always fills both groups — b64 can be empty, never absent.
  const mime = m[1]!
  const b64 = m[2]!
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return { blob: new Blob([bytes], { type: mime }), mime }
}

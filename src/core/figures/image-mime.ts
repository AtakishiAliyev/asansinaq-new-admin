/**
 * The format the BYTES are, never the one a filename or an upload claimed.
 *
 * This exists because a name is not evidence. The reproduction lane stores what
 * the image provider returns under a `.gen.png` path with `contentType:
 * image/png`, and the provider returns JPEG — so three separate places agreed
 * on a format none of them had checked. Two consumers sniff and were fine (a
 * browser showing the review screen, the canvas the guard decodes with); the
 * rasteriser does not, and a `data:image/png` header over JPEG bytes made it
 * draw NOTHING where the figure belonged. The verification wave then reported
 * the figure as absent, which was true of the render and false of the question,
 * and each such row spent two repair rounds re-reading a page that was never
 * the problem.
 *
 * The perverse part is what made it hard to see: a reproduction the guard
 * REJECTED kept the PNG cut and verified fine, so the lane only broke the
 * figures it had judged good.
 *
 * Sniffing rather than re-encoding keeps the provider's own pixels, needs no
 * backfill for rows already written, and cannot lose a generation to a
 * lossy→lossless round trip.
 */
export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

const startsWith = (bytes: Uint8Array, signature: readonly number[]): boolean => {
  if (bytes.length < signature.length) return false
  for (let i = 0; i < signature.length; i += 1) if (bytes[i] !== signature[i]) return false
  return true
}

/** ASCII at a fixed offset — for the container formats that tag themselves. */
const asciiAt = (bytes: Uint8Array, offset: number, text: string): boolean => {
  if (bytes.length < offset + text.length) return false
  for (let i = 0; i < text.length; i += 1) if (bytes[offset + i] !== text.charCodeAt(i)) return false
  return true
}

/**
 * What these bytes actually are, or `null` when nothing recognises them.
 *
 * `null` is a refusal, not a default. Guessing `image/png` is exactly the bug
 * this module was written for, and a caller that cannot name the format is
 * better off drawing nothing visible than drawing something silently wrong.
 */
export function sniffImageMime(bytes: Uint8Array): ImageMime | null {
  // 8-byte PNG signature.
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  // Every JPEG starts SOI; the third byte is the first marker, which varies
  // (0xE0 JFIF, 0xE1 Exif, 0xDB raw quantisation table), so it is not pinned.
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  // RIFF....WEBP — the four size bytes in between are content, so they are
  // skipped rather than matched.
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && asciiAt(bytes, 8, 'WEBP')) return 'image/webp'
  if (asciiAt(bytes, 0, 'GIF87a') || asciiAt(bytes, 0, 'GIF89a')) return 'image/gif'
  return null
}

/** The extension that matches the bytes, so a stored name stops being a claim. */
export function extensionForMime(mime: ImageMime): string {
  switch (mime) {
    case 'image/jpeg':
      return 'jpg'
    case 'image/webp':
      return 'webp'
    case 'image/gif':
      return 'gif'
    case 'image/png':
      return 'png'
  }
}

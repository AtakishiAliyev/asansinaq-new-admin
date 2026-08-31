import { extensionForMime, sniffImageMime } from '@/core/figures/image-mime'
import { eq, suite } from '../harness.ts'

const bytes = (...values: number[]) => Uint8Array.from(values)
const ascii = (text: string) => Uint8Array.from([...text].map((c) => c.charCodeAt(0)))

const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13)
const JFIF = bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46)
const EXIF = bytes(0xff, 0xd8, 0xff, 0xe1, 0x00, 0x10)

export const imageMimeSuite = suite('image-mime', {
  'a png is read from its signature'() {
    eq(sniffImageMime(PNG), 'image/png')
  },

  // The live defect: the reproduction lane stored JFIF bytes as `.gen.png` with
  // contentType image/png, the renderer declared them PNG in a data URI, and
  // resvg drew nothing — so the verification wave reported a figure the row
  // actually had as missing, twice, at two repair rounds each.
  'the jfif bytes the image provider really returns are read as jpeg'() {
    eq(sniffImageMime(JFIF), 'image/jpeg')
  },

  'a jpeg is recognised whatever its first marker is'() {
    eq(sniffImageMime(EXIF), 'image/jpeg')
    eq(sniffImageMime(bytes(0xff, 0xd8, 0xff, 0xdb)), 'image/jpeg')
  },

  'webp is matched past its four content-dependent size bytes'() {
    const webp = new Uint8Array(16)
    webp.set(ascii('RIFF'), 0)
    webp.set(bytes(0x2a, 0x13, 0x00, 0x00), 4)
    webp.set(ascii('WEBP'), 8)
    eq(sniffImageMime(webp), 'image/webp')
  },

  'gif is matched on both of its version tags'() {
    eq(sniffImageMime(ascii('GIF87a....')), 'image/gif')
    eq(sniffImageMime(ascii('GIF89a....')), 'image/gif')
  },

  // A refusal, never a default: guessing png over unknown bytes is the whole
  // defect this module exists to prevent.
  'anything unrecognised refuses rather than defaulting to png'() {
    eq(sniffImageMime(ascii('<svg xmlns=')), null)
    eq(sniffImageMime(bytes(0x00, 0x01, 0x02, 0x03)), null)
  },

  'a truncated header cannot be mistaken for a match'() {
    eq(sniffImageMime(bytes(0x89, 0x50, 0x4e)), null)
    eq(sniffImageMime(new Uint8Array(0)), null)
    // RIFF with nothing after it is not yet a WEBP.
    eq(sniffImageMime(ascii('RIFF')), null)
  },

  'the extension follows the bytes, so a stored name stops being a claim'() {
    eq(extensionForMime('image/jpeg'), 'jpg')
    eq(extensionForMime('image/png'), 'png')
    eq(extensionForMime('image/webp'), 'webp')
    eq(extensionForMime('image/gif'), 'gif')
  },
})

import { classifyFigureRegion } from '@/core/segment/crop'
import { eq, suite } from '../harness.ts'

// The classifier only reads data/width/height, so a plain object is a faithful
// stand-in for the browser's ImageData and the lane routing becomes testable
// without a canvas.
const W = 240
const H = 200
const INK_LUM = 150

function canvas(paint: (set: (x: number, y: number, rgb?: [number, number, number]) => void) => void): ImageData {
  const data = new Uint8ClampedArray(W * H * 4).fill(255)
  paint((x, y, rgb = [0, 0, 0]) => {
    if (x < 0 || x >= W || y < 0 || y >= H) return
    const i = (y * W + x) * 4
    data[i] = rgb[0]
    data[i + 1] = rgb[1]
    data[i + 2] = rgb[2]
  })
  return { data, width: W, height: H, colorSpace: 'srgb' } as ImageData
}

const classify = (img: ImageData) =>
  classifyFigureRegion(img, 0, W, 0, H, INK_LUM, 1)

export const classifySuite = suite('classify', {
  'prose is not a figure'() {
    // Twelve text lines: eight rows of glyphs, four blank, glyph strokes
    // covering roughly a fifth of the line.
    const img = canvas((set) => {
      for (let line = 0; line < 12; line++) {
        const top = 10 + line * 16
        for (let row = top; row < top + 8; row++) {
          for (let x = 10; x < 220; x += 5) {
            set(x, row)
            set(x + 1, row)
          }
        }
      }
    })
    eq(classify(img), 'none', 'növ')
  },

  'a black-and-white triangle is a figure'() {
    // The class the pixel classifier used to miss entirely: no colour, no long
    // horizontal rule, so it went to the plain lane and its figure was never
    // drawn or compared.
    const img = canvas((set) => {
      const apexX = 120
      const baseY = 170
      for (let y = 20; y <= baseY; y++) {
        const half = Math.round(((y - 20) / (baseY - 20)) * 80)
        set(apexX - half, y)
        set(apexX + half, y)
      }
    })
    eq(classify(img), 'rule', 'növ')
  },

  'a coloured drawing is still the coloured lane'() {
    const img = canvas((set) => {
      for (let y = 40; y < 90; y++) {
        for (let x = 40; x < 110; x++) set(x, y, [200, 30, 30])
      }
    })
    eq(classify(img), 'colored', 'növ')
  },

  'a long horizontal rule is a scheme'() {
    const img = canvas((set) => {
      for (let x = 30; x < 120; x++) {
        set(x, 100)
        set(x, 101)
      }
    })
    eq(classify(img), 'rule', 'növ')
  },

  'an empty crop is not a figure'() {
    eq(classify(canvas(() => {})), 'none', 'növ')
  },
})

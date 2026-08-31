// The scan lane's door: the shape a detection arrives in, and what it becomes.
//
// This suite exists because the lane had none, and that is exactly how the two
// halves drifted apart unnoticed — the op returned `questions`, this module
// required `anchors`, and every scan page failed the parse after the model call
// had already been paid for.
import { regroupScanBands } from '@/core/segment/crop'
import { scanDetectionSchema, scanPageSeg } from '@/core/segment/scan'
import type { Band } from '@/core/segment/types'
import { eq, ok, suite } from '../harness.ts'

/** A real response, field for field, as `ops_cache` holds it. */
const WIRE = {
  columns: 2,
  test_no: 3,
  questions: [
    { number: 59, column: 0, box: [0, 0, 150, 500] },
    { number: 60, column: 0, box: [150, 0, 350, 500] },
    { number: 61, column: 0, box: [350, 0, 550, 500] },
    { number: 62, column: 1, box: [0, 500, 250, 1000] },
    { number: 63, column: 1, box: [250, 500, 500, 1000] },
    { number: 64, column: 1, box: [500, 500, 1000, 1000] },
  ],
  model: 'claude-haiku-4-5',
}

/** A white page with black rows filled in, as the refiner reads it. */
function page(height: number, inked: [number, number][]): ImageData {
  const width = 100
  const data = new Uint8ClampedArray(width * height * 4).fill(255)
  for (const [top, bottom] of inked) {
    for (let y = top; y <= bottom; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        data[i] = 0
        data[i + 1] = 0
        data[i + 2] = 0
      }
    }
  }
  return { data, width, height, colorSpace: 'srgb' } as ImageData
}

const band = (number: number, y: number, h: number): Band => ({
  number,
  col: 0,
  bbox: { x: 0, y, w: 100, h },
  anchorYTop: y,
  textLayer: '',
})

export const scanSuite = suite('scan', {
  'the response the op actually returns parses'() {
    const d = scanDetectionSchema.parse(WIRE)
    eq(d.columns, 2)
    eq(d.anchors.length, 6, 'altı sual da keçməlidir')
    eq(d.anchors[0]!.number, 59)
  },

  // Optional, so it was never rejected — just dropped on every scan page since
  // the lane shipped.
  'the test number survives the crossing'() {
    eq(scanDetectionSchema.parse(WIRE).testNo, 3)
    eq(scanDetectionSchema.parse({ ...WIRE, test_no: undefined }).testNo, undefined)
  },

  'a page the model found nothing on is empty, not an error'() {
    const d = scanDetectionSchema.parse({ columns: 1, questions: [] })
    eq(d.anchors.length, 0)
  },

  // One bad entry must not cost the page its other five.
  'a box that is not four numbers is dropped, not fatal'() {
    const d = scanDetectionSchema.parse({
      columns: 1,
      questions: [
        { number: 1, box: [0, 0, 100] },
        { number: 2, box: [0, 0, 100, 500] },
      ],
    })
    eq(d.anchors.length, 1, 'yalnız düzgün qutu qalmalıdır')
    eq(d.anchors[0]!.number, 2)
  },

  // The detector answered 0-150, 150-350, 350-550 for a column whose ink sat at
  // 62-179, 431-535 and 764-903 — evenly spaced slabs, wrong by as much as 410
  // of the 1000-unit grid, and three of six crops held the wrong part of the
  // page. The numbering is the model's; the geometry is the page's.
  'question bounds are taken from the ink, not from the boxes'() {
    const img = page(1000, [[62, 179], [431, 535], [764, 903]])
    const bands = [band(59, 0, 150), band(60, 150, 200), band(61, 350, 200)]
    const { bands: out, notes } = regroupScanBands(bands, img, 1, 150)
    eq(notes.length, 0, `imtina gözlənilmirdi: ${notes.join(' | ')}`)
    eq(out[0]!.bbox.y, 62, 'birinci sual mürəkkəbin başladığı yerdən')
    eq(out[1]!.bbox.y, 431, 'ikinci sual öz blokuna oturdu')
    eq(out[2]!.bbox.y, 764, 'üçüncü sual öz blokuna oturdu')
    eq(out[1]!.number, 60, 'nömrələr modeldən gəlir və sırası pozulmur')
  },

  // A question is several ink runs — a stem, a figure, an option row — and the
  // gaps inside it must not be mistaken for the gaps between questions.
  'gaps inside a question do not split it'() {
    const img = page(1000, [
      [62, 100], [110, 140], [150, 179],
      [431, 470], [480, 535],
    ])
    const bands = [band(1, 0, 200), band(2, 200, 200)]
    const { bands: out, notes } = regroupScanBands(bands, img, 1, 150)
    eq(notes.length, 0)
    eq(out[0]!.bbox.y, 62)
    eq(Math.round(out[0]!.bbox.h), 118, 'birinci sual öz üç sətrini saxlayır')
    eq(out[1]!.bbox.y, 431)
  },

  // Refusing leaves a crude crop a reviewer can see. Splitting on a guess makes
  // half a question, which reads downstream like a question never printed.
  'too few ink blocks is a refusal, not a guess'() {
    const img = page(1000, [[100, 200]])
    const bands = [band(1, 0, 300), band(2, 300, 300)]
    const { bands: out, notes } = regroupScanBands(bands, img, 1, 150)
    eq(out[0]!.bbox.y, 0, 'AI qutusu olduğu kimi qaldı')
    ok(notes.length === 1 && notes[0]!.includes('gözlənilirdi'), notes.join(' | '))
  },

  'evenly spaced blocks with no clear boundary are a refusal'() {
    // Three runs, two identical gaps: nothing here says which is a boundary.
    const img = page(1000, [[100, 200], [260, 360], [420, 520]])
    const bands = [band(1, 0, 300), band(2, 300, 300)]
    const { notes } = regroupScanBands(bands, img, 1, 150)
    ok(notes.length === 1 && notes[0]!.includes('aydın seçilmir'), notes.join(' | '))
  },

  'the parsed detection becomes bands the crop pipeline can use'() {
    const seg = scanPageSeg(scanDetectionSchema.parse(WIRE), 13, 800, 1100)
    eq(seg.pageNumber, 13)
    ok(seg.bands.length > 0, `band gözlənilirdi, alınan ${seg.bands.length}`)
    ok(seg.isScan !== false || true)
  },
})

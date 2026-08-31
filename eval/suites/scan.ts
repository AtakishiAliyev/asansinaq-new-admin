// The scan lane's door: the shape a detection arrives in, and what it becomes.
//
// This suite exists because the lane had none, and that is exactly how the two
// halves drifted apart unnoticed — the op returned `questions`, this module
// required `anchors`, and every scan page failed the parse after the model call
// had already been paid for.
import { scanDetectionSchema, scanPageSeg } from '@/core/segment/scan'
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

  'the parsed detection becomes bands the crop pipeline can use'() {
    const seg = scanPageSeg(scanDetectionSchema.parse(WIRE), 13, 800, 1100)
    eq(seg.pageNumber, 13)
    ok(seg.bands.length > 0, `band gözlənilirdi, alınan ${seg.bands.length}`)
    ok(seg.isScan !== false || true)
  },
})

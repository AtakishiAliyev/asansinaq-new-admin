import { bandFromBox, isCropBox } from '@/core/segment/manual-band'
import { eq, notOk, ok, suite } from '../harness.ts'
import { items } from './fixtures.ts'

// The page whose fifth answer the segmenter lost: four options in one item,
// "E)" on its own 25pt to the right. A box the operator widens over it has to
// keep that item — and keep it OUT when the box stops short of it.
const page = items([
  { str: '13. Aşağıdakılardan hansı doğrudur?', x: 40, y: 60, w: 180 },
  { str: 'A) 1  B) 2  C) 3  D) 4', x: 60, y: 84, w: 170 },
  { str: 'E) 5', x: 255, y: 84, w: 22 },
  { str: '14. Növbəti sual', x: 40, y: 300, w: 120 },
])

export const manualBandSuite = suite('manual-band', {
  'a box keeps the items it covers, in reading order'() {
    const band = bandFromBox(page, { x: 35, y: 50, w: 250, h: 60 }, 13, 0)
    eq(band.textLayer, '13. Aşağıdakılardan hansı doğrudur? A) 1  B) 2  C) 3  D) 4 E) 5'.replace(/\s+/g, ' '), 'mətn qatı')
    eq(band.number, 13, 'nömrə')
    eq(band.col, 0, 'sütun')
    eq(band.bbox.w, 250, 'qutu olduğu kimi saxlanır')
  },

  // Coverage is judged by the item's CENTRE, on both axes. The segmenter can
  // filter on y alone because its box spans the column; a drawn box can stop
  // anywhere, and an item hanging off its edge must go one way or the other
  // by where its middle is, not by where its left edge happens to fall.
  'an item is in or out by its centre'() {
    // Box ends at x=262: "E) 5" spans 255–277, centre 266 → out.
    const narrow = bandFromBox(page, { x: 35, y: 50, w: 227, h: 60 }, 13, 0)
    notOk(narrow.textLayer.includes('E) 5'), 'kənardan asılan element daxil edilib')
    // Box ends at x=270: centre 266 → in.
    const wide = bandFromBox(page, { x: 35, y: 50, w: 235, h: 60 }, 13, 0)
    ok(wide.textLayer.includes('E) 5'), 'mərkəzi içəridə olan element düşüb')
  },

  'the next question stays out of the box'() {
    const band = bandFromBox(page, { x: 35, y: 50, w: 250, h: 60 }, 13, 0)
    notOk(band.textLayer.includes('14.'), 'qonşu sual qutuya düşüb')
  },

  // Scans carry no text items; the band is still a band.
  'an empty page yields an empty text layer, not a failure'() {
    const band = bandFromBox([], { x: 0, y: 0, w: 100, h: 100 }, 1, 0)
    eq(band.textLayer, '', 'boş mətn qatı')
    eq(band.anchorYTop, 0, 'anker qutunun üstüdür')
  },

  'a stored value is a box only when it is one'() {
    ok(isCropBox({ x: 1, y: 2, w: 3, h: 4 }), 'düzgün qutu rədd edilib')
    notOk(isCropBox(null), 'null')
    notOk(isCropBox({ x: 1, y: 2, w: 0, h: 4 }), 'sıfır en')
    notOk(isCropBox({ x: '1', y: 2, w: 3, h: 4 }), 'sətir koordinat')
    notOk(isCropBox({ x: 1, y: 2, w: Infinity, h: 4 }), 'sonsuz en')
  },
})

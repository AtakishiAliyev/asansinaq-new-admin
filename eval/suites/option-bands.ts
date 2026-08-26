// Finding the option rows in a crop, and refusing when they cannot be found.
//
// The case this exists for is reconstructed below as `iqPage`: on a live IQ
// question the model's five boxes spanned 355–680 of the 0–1000 grid while the
// option rows were at 552–999, so the first cut was blank paper and the
// question quietly lost an option. Every assertion here is about the two ways
// that can go wrong — placing a box where there is nothing, and inventing a
// placement when the layout is not understood.
import {
  contentBands,
  localizeFigureBox,
  localizeOptionBoxes,
  type Box,
} from '@/core/segment/option-bands'
import {
  cleanCrop,
  colourRatio,
  inkRatio,
  inventedInk,
  type Pixels,
} from '@/core/segment/image-clean'
import { eq, ok, suite } from '../harness.ts'

function blank(width: number, height: number): Pixels {
  const data = new Uint8ClampedArray(width * height * 4).fill(255)
  return { data, width, height }
}

function fill(
  pix: Pixels,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rgb: [number, number, number],
): void {
  for (let y = Math.max(0, y0); y <= Math.min(pix.height - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(pix.width - 1, x1); x++) {
      const i = (y * pix.width + x) * 4
      pix.data[i] = rgb[0]
      pix.data[i + 1] = rgb[1]
      pix.data[i + 2] = rgb[2]
      pix.data[i + 3] = 255
    }
  }
}

const BLACK: [number, number, number] = [20, 20, 20]
const RED: [number, number, number] = [220, 50, 40]
const GREY: [number, number, number] = [205, 205, 205]

/**
 * The live layout that motivated all of this, to scale.
 *
 * A figure across the top, an inline heading, then five option rows running to
 * the bottom edge — and the heading is the extra band that makes "just take
 * every band" wrong.
 */
function iqPage(): Pixels {
  const pix = blank(900, 670)
  fill(pix, 100, 110, 800, 225, BLACK) // the figure
  fill(pix, 200, 312, 500, 336, BLACK) // "A = ? ; B = ? ; C = ?"
  const rows: [number, number][] = [
    [369, 410],
    [435, 481],
    [501, 546],
    [564, 609],
    [627, 668],
  ]
  for (const [top, bottom] of rows) {
    fill(pix, 60, top, 90, bottom, BLACK) // the "A)" label
    fill(pix, 140, top, 430, bottom, RED) // the coloured circles
  }
  return pix
}

const MODEL_HINT: Box[] = [
  [355, 140, 420, 460],
  [420, 140, 485, 460],
  [485, 140, 550, 460],
  [550, 140, 615, 460],
  [615, 140, 680, 460],
]

export const optionBandsSuite = suite('option-bands', {
  'content bands are found where the content is'() {
    const bands = contentBands(iqPage())
    eq(bands.length, 7, 'figure, heading and five option rows')
  },

  // The whole point: the answer comes from the pixels, and the model's boxes
  // only say roughly where to look.
  'the option boxes snap to the rows, not to the hint'() {
    const result = localizeOptionBoxes(iqPage(), 5, MODEL_HINT)
    ok(result.ok, 'five options were located')
    if (!result.ok) return
    eq(result.boxes.length, 5, 'one box per option')
    const first = result.boxes[0]!
    // The hint put the first option at 355; the row is at 369/670 ≈ 551.
    ok(first[0] > 500, `the first box follows the pixels (${first[0]}), not the hint (355)`)
    ok(first[2] < 640, 'and it ends at its own row rather than running on')
    const last = result.boxes[4]!
    ok(last[2] > 950, `the last box reaches the bottom rows (${last[2]}), which the hint never did`)
  },

  'the boxes are in order and do not overlap'() {
    const result = localizeOptionBoxes(iqPage(), 5, MODEL_HINT)
    ok(result.ok, 'located')
    if (!result.ok) return
    for (let i = 1; i < result.boxes.length; i++) {
      ok(result.boxes[i]![0] > result.boxes[i - 1]![0], `box ${i} starts below box ${i - 1}`)
    }
  },

  // Every box has to actually contain something, which is the exact defect the
  // model produced: a box over blank paper.
  'no box lands on blank paper'() {
    const pix = iqPage()
    const result = localizeOptionBoxes(pix, 5, MODEL_HINT)
    ok(result.ok, 'located')
    if (!result.ok) return
    for (const [index, box] of result.boxes.entries()) {
      const y0 = Math.floor((box[0] / 1000) * pix.height)
      const y1 = Math.ceil((box[2] / 1000) * pix.height)
      const x0 = Math.floor((box[1] / 1000) * pix.width)
      const x1 = Math.ceil((box[3] / 1000) * pix.width)
      let content = 0
      for (let y = y0; y < Math.min(y1, pix.height); y++) {
        for (let x = x0; x < Math.min(x1, pix.width); x++) {
          if (pix.data[(y * pix.width + x) * 4]! < 240) content++
        }
      }
      ok(content > 0, `box ${index} contains content`)
    }
  },

  'the option letter is trimmed when it stands apart'() {
    const result = localizeOptionBoxes(iqPage(), 5, MODEL_HINT)
    ok(result.ok, 'located')
    if (!result.ok) return
    // The label occupies x 60–90 of 900 (≈67–100 normalised); the picture
    // starts at 140 (≈156).
    ok(result.boxes[0]![1] > 120, 'the box starts after the "A)" label')
  },

  // Refusing is the feature. A confidently wrong box deletes an option, and
  // nothing downstream can tell that from an option the book never printed.
  'too few bands is a refusal, not a guess'() {
    const pix = blank(900, 670)
    fill(pix, 140, 400, 430, 450, BLACK)
    fill(pix, 140, 500, 430, 550, BLACK)
    const result = localizeOptionBoxes(pix, 5)
    ok(!result.ok, 'two bands cannot supply five options')
    if (result.ok) return
    ok(result.reason.includes('need 5'), 'and it says what was missing')
  },

  'wildly uneven bands are a refusal'() {
    const pix = blank(900, 900)
    fill(pix, 140, 100, 430, 500, BLACK) // one enormous block
    fill(pix, 140, 600, 430, 620, BLACK)
    fill(pix, 140, 700, 430, 720, BLACK)
    const result = localizeOptionBoxes(pix, 3)
    ok(!result.ok, 'a 400px band beside 20px bands is not an option column')
  },

  // q463 and q464 lay their options out as a grid — three across, then two —
  // so bands alone would find two rows for five options and refuse a page that
  // is perfectly readable.
  'a grid of options is split into cells in reading order'() {
    const pix = blank(900, 800)
    fill(pix, 100, 60, 800, 300, BLACK) // the figure
    const cols: [number, number][] = [
      [90, 270],
      [330, 510],
      [570, 750],
    ]
    for (const [x0, x1] of cols) fill(pix, x0, 380, x1, 520, BLACK)
    for (const [x0, x1] of cols.slice(0, 2)) fill(pix, x0 + 130, 600, x1 + 130, 740, BLACK)

    const gridHint: Box[] = [
      [470, 100, 650, 300],
      [470, 360, 650, 570],
      [470, 630, 650, 840],
      [750, 240, 930, 440],
      [750, 500, 930, 700],
    ]
    const result = localizeOptionBoxes(pix, 5, gridHint)
    ok(result.ok, 'three across then two is five options')
    if (!result.ok) return
    eq(result.boxes.length, 5, 'one box per cell')
    // Reading order: the first three share a row, then the next two.
    eq(result.boxes[0]![0], result.boxes[1]![0], 'A and B are on the same row')
    eq(result.boxes[1]![0], result.boxes[2]![0], 'and so is C')
    ok(result.boxes[3]![0] > result.boxes[2]![0], 'D is on the row below')
    ok(result.boxes[1]![1] > result.boxes[0]![1], 'B is to the right of A')
  },

  // A row that cannot be cut into as many pieces as the hint claims is a
  // refusal: merging by rank always reaches the count when there are enough
  // runs, so too few runs means the layout was misread.
  'a row that cannot supply its options is a refusal'() {
    const pix = blank(900, 800)
    fill(pix, 90, 400, 230, 520, BLACK) // one blob where three options are claimed
    const result = localizeOptionBoxes(pix, 3, [
      [470, 100, 650, 300],
      [470, 360, 650, 570],
      [470, 630, 650, 840],
    ])
    ok(!result.ok, 'one run cannot become three options')
  },

  // The gaps between the three circles of ONE option are narrower than the
  // gutters between options, but not by any margin a fixed threshold survives
  // across books — so the count comes from the hint and only the ordering of
  // the gaps has to hold.
  'circles inside one option do not split it'() {
    const pix = blank(900, 700)
    fill(pix, 100, 60, 800, 300, BLACK)
    const rows: [number, number][] = [[380, 430], [450, 500], [520, 570], [590, 640]]
    for (const [top, bottom] of rows) {
      // Three well-separated circles per option, as the live page prints them.
      for (const x of [180, 280, 380]) fill(pix, x, top, x + 50, bottom, RED)
    }
    const result = localizeOptionBoxes(
      pix,
      4,
      rows.map(([t, b]) => [
        Math.round((t / 700) * 1000), 190, Math.round((b / 700) * 1000), 480,
      ]) as Box[],
    )
    ok(result.ok, 'four rows of three circles are four options')
    if (!result.ok) return
    eq(result.boxes.length, 4, 'not twelve')
    ok(result.boxes[0]![3] - result.boxes[0]![1] > 200, 'each box spans all three circles')
  },

  // The live grids came back with cells 7 and 12 units wide: a speck at the
  // page margin survived as its own run and took an option's place in the
  // count. The option was printed; the cut replaced it with the margin.
  'a speck at the margin does not take an option\u2019s place'() {
    const pix = blank(900, 800)
    fill(pix, 100, 60, 800, 300, BLACK) // the figure
    fill(pix, 2, 400, 4, 520, BLACK) // a 3px speck at the left edge
    const cols: [number, number][] = [
      [90, 270],
      [330, 510],
      [570, 750],
    ]
    for (const [x0, x1] of cols) fill(pix, x0, 400, x1, 520, BLACK)

    const result = localizeOptionBoxes(pix, 3, [
      [490, 100, 650, 300],
      [490, 360, 650, 570],
      [490, 630, 650, 840],
    ])
    ok(result.ok, 'three options are still three options')
    if (!result.ok) return
    for (const box of result.boxes) {
      ok(box[3] - box[1] > 100, `every option is a real width, not a speck (${box[3] - box[1]})`)
    }
  },

  // p311/16: the model's figure box was taken at face value and the cut held
  // the wrong region. Same defect as the option boxes, other lane.
  'a figure box snaps to the drawing, not to the hint'() {
    const pix = blank(900, 800)
    fill(pix, 120, 300, 700, 520, BLACK) // the figure
    fill(pix, 60, 60, 800, 120, BLACK) // the stem, well above it
    // A hint that lands mostly on blank paper between the two.
    const result = localizeFigureBox(pix, [180, 100, 300, 800])
    ok(result.ok, 'located')
    if (!result.ok) return
    // 300/800 = 375, 520/800 = 650 — the drawing, not the hint's 180..300.
    ok(result.box[0] > 330 && result.box[0] < 400, `top follows the ink (${result.box[0]})`)
    ok(result.box[2] > 620 && result.box[2] < 700, `bottom follows the ink (${result.box[2]})`)
  },

  'a figure hint that lands on blank paper falls back to the nearest drawing'() {
    const pix = blank(900, 800)
    fill(pix, 120, 500, 700, 640, BLACK)
    // Hint sits in empty space near the top.
    const result = localizeFigureBox(pix, [20, 100, 60, 800])
    ok(result.ok, 'still located')
    if (!result.ok) return
    ok(result.box[0] > 550, `it took the real block (${result.box[0]})`)
  },

  'a figure box on an empty crop is a refusal'() {
    const result = localizeFigureBox(blank(400, 300), [100, 100, 200, 200])
    ok(!result.ok, 'nothing to snap to')
  },

  'a crop with no content at all is a refusal'() {
    const result = localizeOptionBoxes(blank(400, 300), 5)
    ok(!result.ok, 'nothing to place')
  },

  // The cleaner and the localizer see the same page, so a cleaned crop must
  // still localize — otherwise cleaning would break the cut it feeds.
  'localizing still works after cleaning'() {
    const pix = iqPage()
    // Grey watermark text laid across the options.
    fill(pix, 200, 380, 700, 400, GREY)
    fill(pix, 200, 640, 700, 660, GREY)
    const cleaned = cleanCrop(pix)
    const result = localizeOptionBoxes(cleaned, 5, MODEL_HINT)
    ok(result.ok, 'the rows survive cleaning')
  },
})

export const imageCleanSuite = suite('image-clean', {
  // The measurement that decided the design: the naive cleaners removed 100%
  // of the colour on every coloured crop, and on these books the colour is the
  // answer.
  'deliberate colour survives cleaning'() {
    const pix = blank(400, 300)
    fill(pix, 50, 50, 350, 120, RED)
    const before = colourRatio(pix)
    ok(before > 0.1, 'the fixture is genuinely coloured')
    eq(
      Math.round(colourRatio(cleanCrop(pix)) * 1000),
      Math.round(before * 1000),
      'every coloured pixel is still coloured',
    )
  },

  'a grey watermark is removed'() {
    const pix = blank(400, 300)
    fill(pix, 20, 20, 380, 60, GREY)
    ok(inkRatio(pix) === 0, 'the watermark is lighter than mid-grey to begin with')
    const cleaned = cleanCrop(pix)
    let grey = 0
    for (let p = 0; p < cleaned.width * cleaned.height; p++) {
      const v = cleaned.data[p * 4]!
      if (v > 10 && v < 245) grey++
    }
    eq(grey, 0, 'nothing is left at an in-between level')
  },

  // The failure the pale-pixel count could not see, and which shipped: the
  // local-contrast test alone promoted the darker edges of a watermark to solid
  // black on all eight real crops, 0.4% to 3.8% of the page. On a diagram an
  // invented stroke is worse than the faint mark it replaced.
  'a watermark is never turned into ink'() {
    const pix = blank(400, 300)
    // A wash with a darker core, like the edge of a logo's script.
    fill(pix, 40, 40, 360, 120, [232, 232, 232])
    fill(pix, 60, 60, 340, 100, [196, 196, 196])
    const cleaned = cleanCrop(pix)
    eq(Math.round(inventedInk(pix, cleaned) * 10000), 0, 'nothing pale became black')
    eq(inkRatio(cleaned), 0, 'and the page holds no ink at all')
  },

  'real print is still ink'() {
    const pix = blank(400, 300)
    fill(pix, 40, 40, 360, 120, [232, 232, 232]) // wash over the top of it
    fill(pix, 100, 60, 300, 80, [15, 15, 15]) // a printed stroke
    const cleaned = cleanCrop(pix)
    ok(inkRatio(cleaned) > 0.02, 'the stroke survived the floor')
    eq(Math.round(inventedInk(pix, cleaned) * 10000), 0, 'and the wash did not join it')
  },

  'strokes survive cleaning'() {
    const pix = blank(400, 300)
    fill(pix, 100, 140, 300, 150, BLACK)
    const before = inkRatio(pix)
    const after = inkRatio(cleanCrop(pix))
    ok(after >= before, `the stroke is still there (${before.toFixed(4)} -> ${after.toFixed(4)})`)
  },

  'the input buffer is never mutated'() {
    const pix = blank(80, 60)
    fill(pix, 10, 10, 70, 50, GREY)
    const snapshot = new Uint8ClampedArray(pix.data)
    cleanCrop(pix)
    eq(pix.data.join(','), snapshot.join(','), 'the original is untouched')
  },
})

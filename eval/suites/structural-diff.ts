// The guard that decides whether a generated figure may ever be displayed.
//
// The asymmetry is the whole design and so it is the whole suite: a dashed
// guide that stops short of the axis must PASS, because that is what the
// operator's own sample did and it is harmless; a shaded region that moved must
// FAIL, because which region is shaded is the question itself.
import { compareStructure } from '@/core/figures/structural-diff'
import type { Pixels } from '@/core/segment/image-clean'
import { eq, ok, suite } from '../harness.ts'

const W = 200
const H = 200

function blank(): Pixels {
  return { data: new Uint8ClampedArray(W * H * 4).fill(255), width: W, height: H }
}

function draw(
  pix: Pixels,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rgb: [number, number, number],
): void {
  for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) {
      const i = (y * W + x) * 4
      pix.data[i] = rgb[0]
      pix.data[i + 1] = rgb[1]
      pix.data[i + 2] = rgb[2]
      pix.data[i + 3] = 255
    }
  }
}

const BLACK: [number, number, number] = [20, 20, 20]
const RED: [number, number, number] = [220, 50, 40]
const BLUE: [number, number, number] = [40, 70, 210]

/** Axes, a guide running to the axis, and a shaded block. */
function reference(): Pixels {
  const pix = blank()
  draw(pix, 20, 170, 180, 172, BLACK) // x axis
  draw(pix, 20, 30, 22, 172, BLACK) // y axis
  draw(pix, 24, 60, 120, 62, BLACK) // the dashed guide, reaching the axis
  draw(pix, 60, 100, 140, 150, RED) // the shaded region
  return pix
}

export const structuralDiffSuite = suite('structural-diff', {
  'a figure compared with itself passes'() {
    const d = compareStructure(reference(), reference())
    ok(d.passed, `identical must pass: ${d.reasons.join('; ')}`)
    eq(d.inkIoU, 1, 'perfect ink overlap')
  },

  // The exact defect in the operator's sample: the guide stops short of the
  // axis. Harmless, and a strict comparison would reject every reproduction
  // over it.
  'a guide that stops short of the axis still passes'() {
    const gen = blank()
    draw(gen, 20, 170, 180, 172, BLACK)
    draw(gen, 20, 30, 22, 172, BLACK)
    draw(gen, 32, 60, 120, 62, BLACK) // starts 8px late — the endpoint drift
    draw(gen, 60, 100, 140, 150, RED)
    const d = compareStructure(reference(), gen)
    ok(d.passed, `endpoint drift must be tolerated: ${d.reasons.join('; ')}`)
  },

  // The case the guard exists for: everything looks tidy and the answer moved.
  'a shaded region that moved fails'() {
    const gen = blank()
    draw(gen, 20, 170, 180, 172, BLACK)
    draw(gen, 20, 30, 22, 172, BLACK)
    draw(gen, 24, 60, 120, 62, BLACK)
    draw(gen, 60, 40, 140, 90, RED) // same size, different place
    const d = compareStructure(reference(), gen)
    ok(!d.passed, 'a moved shading must fail')
    ok(
      d.reasons.some((r) => r.includes('shaded')),
      `and it must say so: ${d.reasons.join('; ')}`,
    )
  },

  'a shaded region that changed colour fails'() {
    const gen = blank()
    draw(gen, 20, 170, 180, 172, BLACK)
    draw(gen, 20, 30, 22, 172, BLACK)
    draw(gen, 24, 60, 120, 62, BLACK)
    draw(gen, 60, 100, 140, 150, BLUE) // right place, wrong colour
    const d = compareStructure(reference(), gen)
    ok(!d.passed, 'a recolour must fail')
    ok(
      d.reasons.some((r) => r.includes('colour') || r.includes('hue')),
      `and name the colour: ${d.reasons.join('; ')}`,
    )
  },

  'a shaded region that grew fails'() {
    const gen = blank()
    draw(gen, 20, 170, 180, 172, BLACK)
    draw(gen, 20, 30, 22, 172, BLACK)
    draw(gen, 24, 60, 120, 62, BLACK)
    draw(gen, 50, 90, 165, 165, RED) // much bigger
    const d = compareStructure(reference(), gen)
    ok(!d.passed, 'a grown region must fail')
  },

  'a missing line fails'() {
    const gen = blank()
    draw(gen, 20, 170, 180, 172, BLACK)
    draw(gen, 20, 30, 22, 172, BLACK)
    // the guide is gone entirely
    draw(gen, 60, 100, 140, 150, RED)
    const d = compareStructure(reference(), gen)
    ok(!d.passed, 'a dropped line must fail')
  },

  // A generation arrives at 1024px square against a cut of whatever size the
  // page gave; the comparison has to survive that without rewarding the
  // low-detail side.
  'a generation of a different size is compared on the cut’s terms'() {
    const big: Pixels = { data: new Uint8ClampedArray(400 * 400 * 4).fill(255), width: 400, height: 400 }
    const put = (x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number]) => {
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const i = (y * 400 + x) * 4
          big.data[i] = rgb[0]
          big.data[i + 1] = rgb[1]
          big.data[i + 2] = rgb[2]
          big.data[i + 3] = 255
        }
    }
    put(40, 340, 360, 344, BLACK)
    put(40, 60, 44, 344, BLACK)
    put(48, 120, 240, 124, BLACK)
    put(120, 200, 280, 300, RED)
    const d = compareStructure(reference(), big)
    ok(d.passed, `same figure at 2x must pass: ${d.reasons.join('; ')}`)
  },

  // Silence about labels must never read as a pass: there is no OCR here, and
  // the verification wave is what reads text.
  // The calibration failure that rejected 6 of 8 real reproductions: a 300px
  // crop redrawn at 1024px has THINNER relative strokes, and comparing inked
  // mass read that as losing 21% to 60% of the drawing. Same figure, same
  // lines, thinner pen — must pass.
  'the same figure drawn with a thinner pen passes'() {
    const thick = blank()
    draw(thick, 20, 168, 180, 174, BLACK) // 6px strokes
    draw(thick, 18, 30, 24, 174, BLACK)
    draw(thick, 60, 100, 140, 150, RED)

    const thin = blank()
    draw(thin, 20, 170, 180, 171, BLACK) // 1px strokes, same lines
    draw(thin, 20, 30, 21, 171, BLACK)
    draw(thin, 60, 100, 140, 150, RED)

    const d = compareStructure(thick, thin)
    ok(d.passed, `stroke weight must not decide: ${d.reasons.join('; ')}`)
  },

  // ...and the guard must still see a real loss at that same stroke weight,
  // otherwise the fix has become a rubber stamp.
  'a thinner pen does not hide a missing line'() {
    const thick = blank()
    draw(thick, 20, 168, 180, 174, BLACK)
    draw(thick, 18, 30, 24, 174, BLACK)
    draw(thick, 40, 60, 130, 66, BLACK) // a third line, well clear of the axes
    draw(thick, 60, 100, 140, 150, RED)

    const thinAndMissing = blank()
    draw(thinAndMissing, 20, 170, 180, 171, BLACK)
    draw(thinAndMissing, 20, 30, 21, 171, BLACK)
    // the third line is gone
    draw(thinAndMissing, 60, 100, 140, 150, RED)

    const d = compareStructure(thick, thinAndMissing)
    ok(!d.passed, 'a dropped line must still fail when strokes are thinner')
  },

  // An anti-aliased edge puts a sliver into a hue that is otherwise absent.
  // That scored 0.01 and rejected figures whose shading overlapped at 0.95.
  'a hue sliver from anti-aliasing is not a recolour'() {
    const ref = blank()
    draw(ref, 60, 100, 140, 150, RED)
    const withFringe = blank()
    draw(withFringe, 60, 100, 140, 150, RED)
    draw(withFringe, 60, 99, 140, 99, [200, 120, 90]) // a one-pixel warm fringe
    const d = compareStructure(ref, withFringe)
    ok(d.passed, `an edge fringe must not read as a recolour: ${d.reasons.join('; ')}`)
  },

  // Hue is a WHEEL, and red sits on the seam. The live two-ellipse Venn had its
  // red at about 5 degrees in the scan and 355 in the reproduction — ten
  // degrees apart, and on opposite sides of the wrap — which coarse buckets
  // scored as half the palette moving.
  'a hue that straddles the wrap point is not a recolour'() {
    const a = blank()
    draw(a, 40, 40, 160, 160, [230, 40, 30]) // hue just above 0
    const b = blank()
    draw(b, 40, 40, 160, 160, [230, 30, 40]) // hue just below 360
    const d = compareStructure(a, b)
    ok(d.passed, `a ten-degree hue difference must pass: ${d.reasons.join('; ')}`)
    ok(d.hueAgreement > 0.9, `palette should read as intact, got ${d.hueAgreement}`)
  },

  // Figures drawn entirely in colour: the black channel is labels, and labels
  // are this function's declared blind spot. It must SAY it is not measuring
  // them rather than judge them anyway — three faithful live reproductions were
  // rejected on 57-pixel skeletons of their question numbers.
  'ink checks abstain on a figure that is drawn in colour'() {
    const a = blank()
    draw(a, 30, 30, 170, 90, RED)
    draw(a, 30, 110, 170, 170, BLUE)
    draw(a, 4, 4, 10, 12, BLACK) // a question number, and nothing else
    const b = blank()
    draw(b, 30, 30, 170, 90, RED)
    draw(b, 30, 110, 170, 170, BLUE)
    draw(b, 5, 4, 9, 13, BLACK) // drawn a shade differently, as a redraw would
    const d = compareStructure(a, b)
    ok(!d.inkMeasurable, 'so little line art must be declared unmeasurable')
    ok(d.passed, `colour-only figures must not fail on labels: ${d.reasons.join('; ')}`)
  },

  // ...and abstaining on ink must not become abstaining. The colour checks are
  // what carry such a figure, and they are the strict ones.
  'a colour-only figure still fails when a coloured region goes missing'() {
    const a = blank()
    draw(a, 30, 30, 170, 90, RED)
    draw(a, 30, 110, 170, 170, BLUE)
    draw(a, 4, 4, 10, 12, BLACK)
    const b = blank()
    draw(b, 30, 30, 170, 90, RED)
    // the blue region is gone
    draw(b, 4, 4, 10, 12, BLACK)
    const d = compareStructure(a, b)
    ok(!d.inkMeasurable, 'still no line art to measure')
    ok(!d.passed, 'a lost coloured region must fail on the colour checks')
  },

  'labels are declared unchecked'() {
    eq(compareStructure(reference(), reference()).labelsChecked, false, 'declared')
  },
})

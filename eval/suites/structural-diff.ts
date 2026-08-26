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
  'labels are declared unchecked'() {
    eq(compareStructure(reference(), reference()).labelsChecked, false, 'declared')
  },
})

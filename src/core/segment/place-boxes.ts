// Where a picture option or a cut figure actually sits, with the row's flags.
//
// The localizers in `option-bands.ts` answer the geometric question. This
// answers the pipeline's: what box does the cutter use, and what does the row
// have to say about how it was chosen. Two runtimes cut pictures out of a crop
// — the worker after a batch, the review screen after a single re-run — and
// until this existed only the worker measured. The browser took the model's
// boxes at face value, which is the exact mistake the localizer was written to
// stop: on one live page five boxes spanned 355-680 while the rows sat at
// 552-999, and the first cut was blank paper.
//
// Pure, so the free eval can hold both callers to the same decision.
import type { Flag } from '@/core/questions/lint'
import type { Pixels } from '@/core/segment/image-clean'
import {
  localizeFigureBox,
  localizeOptionBoxes,
  type Box,
} from '@/core/segment/option-bands'

export interface PlacedOptions {
  /** One entry per option asked for; null where nothing can be cut. */
  boxes: (Box | null)[]
  flags: Flag[]
}

/**
 * Boxes for the options that declared themselves pictures.
 *
 * The model's boxes are a HINT about where to look. It says which options are
 * pictures and in what order, which it is good at, and where they sit, which
 * it is measurably bad at. The ink decides; the hint only says how many rows to
 * expect and roughly where to start.
 *
 * Refused, not guessed: when the ink cannot be read into the right number of
 * cells the model's boxes are used as they are — they are sometimes correct —
 * and the row is flagged either way, because a cut nothing measured is a cut
 * nobody has checked. With no boxes from the model either, nothing is cut and
 * the row carries an error rather than five empty options that look like a
 * model failure.
 */
export function placeOptionBoxes(pix: Pixels, hints: (Box | undefined)[]): PlacedOptions {
  const expected = hints.length
  if (!expected) return { boxes: [], flags: [] }
  const hint = hints.filter((b): b is Box => !!b)
  const located = localizeOptionBoxes(pix, expected, hint.length ? hint : undefined)
  if (located.ok) return { boxes: located.boxes, flags: [] }

  if (hint.length !== expected) {
    return {
      boxes: hints.map(() => null),
      flags: [
        {
          level: 'error',
          code: 'option_boxes_missing',
          message: 'Variant şəkilləri üçün nə ölçülmüş, nə də modelin verdiyi qutu var',
        },
      ],
    }
  }
  return {
    boxes: hints.map((b) => b ?? null),
    flags: [
      {
        level: 'warning',
        code: 'option_boxes_unverified',
        message: `Variant şəkillərinin yeri ölçülə bilmədi (${located.reason}) — kəsimləri gözlə yoxlayın`,
      },
    ],
  }
}

/**
 * The box for a figure that declared itself a region of the crop.
 *
 * Same rule: the model's coordinates say WHERE IN THE FLOW to look, the ink
 * decides the rectangle, and the printed question number is not part of the
 * drawing. When the ink cannot be read the hint is used unchecked and the row
 * says so; with no hint at all there is nothing to cut.
 */
export function placeFigureBox(
  pix: Pixels,
  hint: Box | null,
  questionNumber: number,
): { box: Box | null; flags: Flag[] } {
  const located = localizeFigureBox(pix, hint, { questionNumber })
  if (located.ok) return { box: located.box, flags: [] }
  return {
    box: hint,
    flags: [
      {
        level: 'warning',
        code: 'figure_box_unverified',
        message: `Fiqurun yeri ölçülə bilmədi (${located.reason}) — kəsimi gözlə yoxlayın`,
      },
    ],
  }
}

/**
 * `[ymin, xmin, ymax, xmax]` on a 0-1000 grid → pixels on this image.
 *
 * Rounded outward and clamped: a box that runs a pixel past the edge should
 * yield the edge, not throw, and a box rounded to nothing should still be one
 * pixel rather than an invalid canvas. Shared so the worker and the browser cut
 * the same pixels from the same box.
 */
export function boxToRect(
  box: Box,
  width: number,
  height: number,
): { sx: number; sy: number; sw: number; sh: number } {
  const [ymin, xmin, ymax, xmax] = box
  const sx = Math.max(0, Math.min(width - 1, Math.floor((xmin / 1000) * width)))
  const sy = Math.max(0, Math.min(height - 1, Math.floor((ymin / 1000) * height)))
  const sw = Math.max(1, Math.min(width - sx, Math.ceil(((xmax - xmin) / 1000) * width)))
  const sh = Math.max(1, Math.min(height - sy, Math.ceil(((ymax - ymin) / 1000) * height)))
  return { sx, sy, sw, sh }
}

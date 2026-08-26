// Cutting the picture options out of the crop they came from.
//
// A question whose options ARE pictures gives the model nothing to write down:
// it marks each option `is_image` and reports the box the picture occupies. The
// picture itself is already in our hands — it is a region of the crop we sent —
// so producing it is a canvas operation, not a model call. It costs nothing,
// it cannot hallucinate, and the pixels are the source's own.
//
// The MVP pipeline used the same box to feed an image model, storing a redrawn
// approximation instead of the region. Removing that lane removed the redraw,
// and the crop went with it by accident: the boxes arrived on every option and
// were dropped one layer before anything could use them, leaving five options
// with neither text nor picture and a row that read as a model failure.
//
// Geometry matches src/features/questions/lib/image.ts exactly, so the browser
// and the worker cut the same pixels from the same box.
import { createCanvas, loadImage } from '@napi-rs/canvas'
import type { ExtractedOption, ExtractedQuestion } from '@/core/questions/extraction'
import type { ImageFig } from '@/core/figures/figspec'
import type { Flag } from '@/core/questions/lint'
import { cleanCrop, type Pixels } from '@/core/segment/image-clean'
import {
  localizeFigureBox,
  localizeOptionBoxes,
  type Box,
} from '@/core/segment/option-bands'
import type { Db, QuestionRow } from './db.ts'
import { FIGURE_GEN_OP, guardedReproduction } from './figure-gen.ts'
import { budgetExhausted, logOp } from './ops.ts'
import { config } from './config.ts'

/** Where crops and generated images live, by convention shared with the UI. */
export function optionImagePath(row: QuestionRow, label: string): string {
  return `${row.book_id}/p${row.page_number}_c${row.col}_q${row.q_no}_opt${label}.png`
}

/** Same convention, for a figure the vector kinds could not express. */
export function figureImagePath(row: QuestionRow, index: number): string {
  return `${row.book_id}/p${row.page_number}_c${row.col}_q${row.q_no}_fig${index}.png`
}

/** Where a guarded reproduction lives, beside the cut it was drawn from. */
export function figureGenPath(row: QuestionRow, index: number): string {
  return figureImagePath(row, index).replace(/\.png$/, '.gen.png')
}

/**
 * The uncleaned twin of a cut, stored beside it.
 *
 * Cleaning is a set of thresholds, and thresholds get retuned. Keeping the raw
 * cut means a retune is a pure image job over what is already in the bucket —
 * no re-extraction, no model call, no new boxes — which is the difference
 * between trying a better cleaner and paying to read every crop again.
 */
const rawTwin = (path: string): string => path.replace(/\.png$/, '.raw.png')

/**
 * `[ymin, xmin, ymax, xmax]` on a 0-1000 grid → pixels on this image.
 *
 * Rounded outward and clamped: a box that runs a pixel past the edge should
 * yield the edge, not throw, and a box rounded to nothing should still be one
 * pixel rather than an invalid canvas.
 */
function toRect(
  box: [number, number, number, number],
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

/**
 * Fills in `image` for every option that declared a picture and said where it
 * is. Returns how many were produced.
 *
 * Options are mutated in place because the caller writes the same array to the
 * row. An option whose crop fails keeps `isImage` and no image, so lint still
 * reports it as empty — the honest state — rather than the question silently
 * losing an option.
 */
/** The whole crop as raw pixels, for measuring and for cleaning. */
async function pixelsOf(crop: { image: string }): Promise<{
  pix: Pixels
  image: Awaited<ReturnType<typeof loadImage>>
}> {
  const image = await loadImage(Buffer.from(crop.image, 'base64'))
  const canvas = createCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, 0, 0)
  const raw = ctx.getImageData(0, 0, image.width, image.height)
  return { pix: { data: raw.data, width: image.width, height: image.height }, image }
}

/** Cut one region, clean it, and store both copies. Returns the stored path. */
async function cutAndStore(
  db: Db,
  source: Awaited<ReturnType<typeof loadImage>>,
  box: Box,
  path: string,
): Promise<{ png: Buffer; pixels: Pixels } | null> {
  const { sx, sy, sw, sh } = toRect(box, source.width, source.height)
  const canvas = createCanvas(sw, sh)
  const ctx = canvas.getContext('2d')
  // Painted white first: a JPEG source has no alpha, but a PNG region can, and
  // an option rendered on a transparent ground disappears against a dark
  // review screen.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, sw, sh)
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh)

  const raw = ctx.getImageData(0, 0, sw, sh)
  const rawBuffer = canvas.toBuffer('image/png')

  const cleaned = cleanCrop({ data: raw.data, width: sw, height: sh })
  const outCanvas = createCanvas(sw, sh)
  const outCtx = outCanvas.getContext('2d')
  const outData = outCtx.createImageData(sw, sh)
  outData.data.set(cleaned.data)
  outCtx.putImageData(outData, 0, 0)

  for (const [target, buffer] of [
    [path, outCanvas.toBuffer('image/png')],
    [rawTwin(path), rawBuffer],
  ] as const) {
    const { error } = await db.storage
      .from('question-crops')
      .upload(target, buffer, { upsert: true, contentType: 'image/png' })
    if (error) throw new Error(error.message)
  }
  return { png: outCanvas.toBuffer('image/png'), pixels: cleaned }
}

/**
 * One figure through the reproduction lane, with the ledger and the budget.
 *
 * Everything here is best-effort by construction: the cut is already stored and
 * already the figure, so a provider outage, an exhausted budget or a rejected
 * reproduction all leave a working question and a flag explaining what was not
 * done. That is the property that makes the lane safe to switch on per book.
 */
async function runGuardedGeneration(
  db: Db,
  row: QuestionRow,
  index: number,
  cut: { png: Buffer; pixels: Pixels },
): Promise<{ path?: string; flag?: Flag }> {
  if (await budgetExhausted(db).catch(() => true)) {
    return {
      flag: {
        level: 'warning',
        code: 'gen_skipped',
        message: 'Günlük büdcə dolub — fiqur kəsim olaraq qaldı',
      },
    }
  }

  const started = Date.now()
  const result = await guardedReproduction(cut.png, cut.pixels, async (png) => {
    const img = await loadImage(png)
    const canvas = createCanvas(img.width, img.height)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const raw = ctx.getImageData(0, 0, img.width, img.height)
    return { data: raw.data, width: img.width, height: img.height }
  })

  await logOp(db, {
    op: FIGURE_GEN_OP,
    model: config.GEMINI_IMAGE_MODEL ?? 'gemini(unset)',
    usage: {
      input: result.usage.input,
      cacheWrite: 0,
      cacheRead: 0,
      output: result.usage.output,
    },
    viaBatch: false,
    cached: false,
    ms: Date.now() - started,
  }).catch(() => {})

  if (!result.png) {
    return {
      flag: {
        level: 'warning',
        code: 'gen_rejected',
        message:
          `Fiqurun 1:1 təkrar çəkilişi qəbul edilmədi (${result.attempts} cəhd): ` +
          `${result.rejection ?? 'səbəb bilinmir'} — orijinal kəsim saxlanıldı`,
      },
    }
  }

  const path = figureGenPath(row, index)
  const { error } = await db.storage
    .from('question-crops')
    .upload(path, result.png, { upsert: true, contentType: 'image/png' })
  if (error) {
    return {
      flag: {
        level: 'warning',
        code: 'gen_rejected',
        message: `Təkrar çəkiliş saxlanıla bilmədi: ${error.message} — kəsim saxlanıldı`,
      },
    }
  }
  return { path }
}

export async function attachOptionImages(
  db: Db,
  row: QuestionRow,
  crop: { image: string; mime: string },
  options: ExtractedOption[],
): Promise<{ produced: number; failed: number; flags: Flag[] }> {
  const wanted = options.filter((o) => o.isImage && !o.image)
  if (!wanted.length) return { produced: 0, failed: 0, flags: [] }

  const { pix, image: source } = await pixelsOf(crop)
  const flags: Flag[] = []

  // The model's boxes are a HINT about where to look. It says which options are
  // pictures and in what order, which it is good at, and where they sit, which
  // it is measurably bad at — on one live page its five boxes spanned 355-680
  // while the rows were at 552-999, so the first cut was blank paper.
  const hint = wanted.map((o) => o.box).filter((b): b is Box => !!b)
  const located = localizeOptionBoxes(pix, wanted.length, hint.length ? hint : undefined)

  if (located.ok) {
    for (const [index, option] of wanted.entries()) option.box = located.boxes[index]!
  } else {
    // Refused, not guessed. Falling back to the model's boxes is right — they
    // are sometimes correct — but the row is flagged either way, because a cut
    // nothing measured is a cut nobody has checked.
    flags.push({
      level: 'warning',
      code: 'option_boxes_unverified',
      message: `Variant şəkillərinin yeri ölçülə bilmədi (${located.reason}) — kəsimləri gözlə yoxlayın`,
    })
    if (hint.length !== wanted.length) {
      return {
        produced: 0,
        failed: wanted.length,
        flags: [
          {
            level: 'error',
            code: 'option_boxes_missing',
            message: 'Variant şəkilləri üçün nə ölçülmüş, nə də modelin verdiyi qutu var',
          },
        ],
      }
    }
  }

  let produced = 0
  let failed = 0
  for (const option of wanted) {
    if (!option.box) {
      failed++
      continue
    }
    try {
      const path = optionImagePath(row, option.label)
      await cutAndStore(db, source, option.box, path)
      option.image = path
      produced++
    } catch (error) {
      failed++
      console.warn(
        `[q${row.id}] option ${option.label} could not be cut: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  return { produced, failed, flags }
}

/**
 * Cuts out any figure that declared itself a region of the crop.
 *
 * The counterpart to the option cropper, and it exists for the same reason:
 * some figures cannot be drawn from a description, and the pixels are already
 * in our hands. Without it a model facing an inexpressible figure does not fail
 * loudly — it writes an apology into the drawing, which renders as a sentence
 * where the figure should be.
 *
 * Mutates in place; the caller writes the same document to the row.
 */
export async function attachFigureImages(
  db: Db,
  row: QuestionRow,
  crop: { image: string; mime: string },
  question: ExtractedQuestion,
): Promise<{ produced: number; failed: number; flags: Flag[] }> {
  const wanted = (question.figures?.items ?? [])
    .map((item, index) => ({ item, index }))
    .filter(
      (entry): entry is { item: ImageFig; index: number } =>
        entry.item.kind === 'image' && !entry.item.src,
    )
  if (!wanted.length) return { produced: 0, failed: 0, flags: [] }

  const { pix, image: source } = await pixelsOf(crop)
  const flags: Flag[] = []
  let produced = 0
  let failed = 0

  // Per book, so the lane can be A/B'd during rollout. Unknown or unreadable
  // means 'cut', which is the lane that cannot be wrong about the page.
  const { data: book } = await db
    .from('books')
    .select('figure_render')
    .eq('id', row.book_id)
    .maybeSingle()
  const lane = book?.figure_render === 'gen' ? 'gen' : 'cut'

  for (const { item, index } of wanted) {
    try {
      // Same rule as the option boxes: the model's coordinates are a hint about
      // WHERE IN THE FLOW to look, and the ink decides the rectangle. On p311/16
      // the hint was taken at face value and the cut held the wrong region.
      const located = localizeFigureBox(pix, item.box ?? null)
      if (located.ok) {
        item.box = located.box
      } else {
        flags.push({
          level: 'warning',
          code: 'figure_box_unverified',
          message: `Fiqurun yeri ölçülə bilmədi (${located.reason}) — kəsimi gözlə yoxlayın`,
        })
        if (!item.box) {
          failed++
          continue
        }
      }
      const { sw, sh } = toRect(item.box!, source.width, source.height)
      const path = figureImagePath(row, index)
      const cut = await cutAndStore(db, source, item.box!, path)
      item.src = path
      // Recorded so the renderer can draw it undistorted without loading it.
      item.w = sw
      item.h = sh
      produced++

      // The reproduction lane, if this book is on it. The cut is already
      // stored and already the figure at this point, so everything below can
      // fail in any way and leave a working question behind.
      if (lane === 'gen' && cut) {
        const gen = await runGuardedGeneration(db, row, index, cut)
        if (gen.flag) {
          flags.push(gen.flag)
          // Also on the figure, so the review screen can put the reason next to
          // the picture it is about rather than at the bottom of the question.
          item.genRejected = gen.flag.message
        }
        if (gen.path) {
          // The cut stays in `src` as the source of truth; the reproduction is
          // what gets DISPLAYED, and only ever after passing the guard.
          item.genSrc = gen.path
        }
      }
    } catch (error) {
      failed++
      console.warn(
        `[q${row.id}] figure ${index} could not be cut: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  return { produced, failed, flags }
}

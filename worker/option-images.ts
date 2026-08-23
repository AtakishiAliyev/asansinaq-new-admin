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
import type { ExtractedOption } from '@/core/questions/extraction'
import type { Db, QuestionRow } from './db.ts'

/** Where crops and generated images live, by convention shared with the UI. */
export function optionImagePath(row: QuestionRow, label: string): string {
  return `${row.book_id}/p${row.page_number}_c${row.col}_q${row.q_no}_opt${label}.png`
}

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
export async function attachOptionImages(
  db: Db,
  row: QuestionRow,
  crop: { image: string; mime: string },
  options: ExtractedOption[],
): Promise<{ produced: number; failed: number }> {
  const wanted = options.filter((o) => o.isImage && o.box && !o.image)
  if (!wanted.length) return { produced: 0, failed: 0 }

  const source = await loadImage(Buffer.from(crop.image, 'base64'))
  let produced = 0
  let failed = 0

  for (const option of wanted) {
    try {
      const { sx, sy, sw, sh } = toRect(option.box!, source.width, source.height)
      const canvas = createCanvas(sw, sh)
      const ctx = canvas.getContext('2d')
      // Painted white first: a JPEG source has no alpha, but a PNG region can,
      // and an option rendered on a transparent ground disappears against a
      // dark review screen.
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, sw, sh)
      ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh)

      const path = optionImagePath(row, option.label)
      const { error } = await db.storage
        .from('question-crops')
        .upload(path, canvas.toBuffer('image/png'), {
          upsert: true,
          contentType: 'image/png',
        })
      if (error) throw new Error(error.message)
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
  return { produced, failed }
}

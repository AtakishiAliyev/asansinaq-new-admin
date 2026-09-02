// Cutting pictures out of a crop, in the browser.
//
// The twin of `worker/option-images.ts`, for the review screen's single re-run.
// The decisions are not made here: which box to cut is `core/segment/
// place-boxes.ts`, how to clean it is `core/segment/image-clean.ts`, where to
// store it is `core/questions/image-paths.ts`. What this file owns is the
// canvas — the one part that is genuinely different between Node and a tab.
//
// It exists because the re-run used to skip all three. It took the model's
// option boxes at face value, never cut a figure at all (a `kind: image` figure
// came back with an empty `src` and rendered as nothing), and ignored the
// book's figure lane. A row re-run from the review screen was therefore a
// different row from the one the worker would have written from the same
// crop, and the review screen is the last place a question should quietly
// change meaning.
//
// What it still cannot do is the reproduction lane: that needs the image
// provider's key, which lives with the worker and must never reach a tab. On a
// `gen` book the cut is stored and shown, and the row says so.
import { supabase } from '@/lib/supabase'
import type { ImageFig } from '@/core/figures/figspec'
import type { ExtractedQuestion } from '@/core/questions/extraction'
import { figureImagePath, optionImagePath, type PathRow } from '@/core/questions/image-paths'
import type { Flag } from '@/core/questions/lint'
import { cleanCrop, type Pixels } from '@/core/segment/image-clean'
import type { Box } from '@/core/segment/option-bands'
import { boxToRect, placeFigureBox, placeOptionBoxes } from '@/core/segment/place-boxes'
import { modelCropSize } from '@/core/segment/model-crop'
import { reproductionPolicy } from '@/core/figures/gen-policy'

export interface LoadedCrop {
  image: HTMLImageElement
  pix: Pixels
}

/** The crop decoded once, for measuring and for cutting. */
export async function loadCrop(dataUrl: string): Promise<LoadedCrop> {
  const image = new Image()
  image.src = dataUrl
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context alınmadı')
  ctx.drawImage(image, 0, 0)
  const raw = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return { image, pix: { data: raw.data, width: canvas.width, height: canvas.height } }
}

/**
 * The crop as the model should see it — the same shrink the worker applies,
 * so a re-run reads the picture the batch read. Returned unchanged when the
 * crop is already at the model width.
 */
export async function shrinkForModel(dataUrl: string): Promise<string> {
  const image = new Image()
  image.src = dataUrl
  await image.decode()
  const target = modelCropSize(image.naturalWidth, image.naturalHeight)
  if (!target) return dataUrl
  const canvas = document.createElement('canvas')
  canvas.width = target.width
  canvas.height = target.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context alınmadı')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, target.width, target.height)
  ctx.drawImage(image, 0, 0, target.width, target.height)
  return canvas.toDataURL('image/png')
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('PNG yaradıla bilmədi'))),
      'image/png',
    )
  })
}

async function upload(path: string, blob: Blob): Promise<void> {
  const { error } = await supabase.storage
    .from('question-crops')
    .upload(path, blob, { upsert: true, contentType: 'image/png' })
  if (error) throw new Error(error.message)
}

/**
 * Cut one region, clean it, and store both copies — the same two objects the
 * worker writes, so a cleaner retune stays a pure image job over the bucket.
 */
export async function cutAndStore(
  crop: LoadedCrop,
  box: Box,
  path: string,
): Promise<{ w: number; h: number }> {
  const { sx, sy, sw, sh } = boxToRect(box, crop.pix.width, crop.pix.height)
  const canvas = document.createElement('canvas')
  canvas.width = sw
  canvas.height = sh
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context alınmadı')
  // Painted white first: a PNG region can carry alpha, and an option rendered
  // on a transparent ground disappears against a dark review screen.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, sw, sh)
  ctx.drawImage(crop.image, sx, sy, sw, sh, 0, 0, sw, sh)
  const raw = ctx.getImageData(0, 0, sw, sh)
  const rawBlob = await toBlob(canvas)

  const cleaned = cleanCrop({ data: raw.data, width: sw, height: sh })
  const out = ctx.createImageData(sw, sh)
  out.data.set(cleaned.data)
  ctx.putImageData(out, 0, 0)
  const cleanBlob = await toBlob(canvas)

  await upload(path, cleanBlob)
  await upload(path.replace(/\.png$/, '.raw.png'), rawBlob)
  return { w: sw, h: sh }
}

export interface CutOutcome {
  produced: number
  failed: number
  flags: Flag[]
}

/**
 * Fills in `image` for every option that declared a picture. Mutates in place;
 * the caller writes the same array to the row. An option whose cut fails keeps
 * `isImage` and no image, so lint reports it as empty — the honest state.
 */
export async function attachOptionImages(
  row: PathRow,
  crop: LoadedCrop,
  question: ExtractedQuestion,
): Promise<CutOutcome> {
  const wanted = question.options.filter((o) => o.isImage && !o.image)
  if (!wanted.length) return { produced: 0, failed: 0, flags: [] }

  const placed = placeOptionBoxes(crop.pix, wanted.map((o) => o.box))
  for (const [index, option] of wanted.entries()) {
    option.box = placed.boxes[index] ?? undefined
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
      await cutAndStore(crop, option.box, path)
      option.image = path
      produced++
    } catch {
      failed++
    }
  }
  return { produced, failed, flags: placed.flags }
}

/**
 * Cuts out every figure that declared itself a region of the crop. Mutates in
 * place; the caller writes the same document to the row.
 */
export async function attachFigureImages(
  row: PathRow,
  crop: LoadedCrop,
  question: ExtractedQuestion,
  lane: 'cut' | 'gen',
): Promise<CutOutcome> {
  const wanted = (question.figures?.items ?? [])
    .map((item, index) => ({ item, index }))
    .filter(
      (entry): entry is { item: ImageFig; index: number } =>
        entry.item.kind === 'image' && !entry.item.src,
    )
  if (!wanted.length) return { produced: 0, failed: 0, flags: [] }

  const flags: Flag[] = []
  let produced = 0
  let failed = 0
  let awaitingWorker = 0
  for (const { item, index } of wanted) {
    const placed = placeFigureBox(crop.pix, item.box ?? null, row.q_no)
    flags.push(...placed.flags)
    if (!placed.box) {
      failed++
      continue
    }
    try {
      item.box = placed.box
      const path = figureImagePath(row, index)
      const { w, h } = await cutAndStore(crop, item.box, path)
      item.src = path
      item.w = w
      item.h = h
      produced++
    } catch {
      failed++
      continue
    }
    if (lane !== 'gen') continue
    // The same policy the worker applies: where the shading is the question,
    // no reproduction is attempted anywhere. Otherwise the lane would run in
    // the worker, and that is not here — said on the figure either way.
    const policy = reproductionPolicy(question, item)
    if (!policy.allowed) {
      item.genSkipped = policy.reason
    } else {
      item.genSkipped = 'Təkrar çəkiliş yalnız worker-də işləyir — reproduksiya üçün sualı növbəyə salın'
      awaitingWorker++
    }
  }

  // A reviewer looking at a gen book expects a reproduction and would
  // otherwise read the cut as the lane having failed.
  if (awaitingWorker) {
    flags.push({
      level: 'warning',
      code: 'gen_skipped',
      message:
        'Təkrar çəkiliş yalnız worker-də işləyir — kəsim göstərilir. ' +
        'Reproduksiya üçün sualı növbəyə salın.',
    })
  }
  return { produced, failed, flags }
}

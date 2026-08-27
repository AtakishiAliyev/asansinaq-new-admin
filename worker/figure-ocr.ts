// Reading the writing on a figure, so the guard can compare it.
//
// Two things here are load bearing and neither is obvious.
//
// UPSCALING. A cleaned cut is 280-350 pixels tall, and tesseract is built for
// scanned pages at 300dpi. Read at native size, the seven live pairs produced
// misreadings that would have rejected three faithful reproductions — including
// one where the cut's own "6" came back as "8", so the guard would have
// reported a label change that existed only inside the OCR. Rendering both
// sides up to a common height fixed all three.
//
// ONE WORKER, REUSED. Starting a tesseract worker loads a language model and
// costs seconds; a figure-heavy page would spend more time starting engines
// than drawing. It is created on first use and torn down with the process.
import { mkdirSync } from 'node:fs'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { createWorker, type Worker } from 'tesseract.js'
import type { OcrToken } from '@/core/figures/labels'

/** Gitignored: the language model is a ~5MB binary, and tesseract's default
 *  cache path is the working directory — the repo root. */
const CACHE_DIR = 'local/tesseract'

/** What both sides are rendered to before reading. See the note above. */
const OCR_HEIGHT = 1100

let engine: Promise<Worker> | null = null

function ocrWorker(): Promise<Worker> {
  // Under `local/`, which is gitignored. The model is a ~5MB binary downloaded
  // on first use, and the default cache path is the working directory — so
  // without this it lands in the repo root and the next commit tries to take it
  // along.
  if (!engine) {
    // Created before the worker, because tesseract silently falls back to
    // re-downloading the 5MB model on every start if the directory is absent.
    mkdirSync(CACHE_DIR, { recursive: true })
    engine = createWorker('eng', undefined, { cachePath: CACHE_DIR })
  }
  return engine
}

/** Released with the process; the worker daemon calls this on shutdown. */
export async function closeOcr(): Promise<void> {
  const current = engine
  engine = null
  if (!current) return
  await current.then((w) => w.terminate()).catch(() => {})
}

async function upscale(png: Buffer): Promise<Buffer> {
  const img = await loadImage(png)
  const scale = Math.max(1, OCR_HEIGHT / img.height)
  const width = Math.round(img.width * scale)
  const height = Math.round(img.height * scale)
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = true
  // On white: a transparent ground reads as black to the binariser, which turns
  // the whole figure into one inked block and returns nothing.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(img, 0, 0, width, height)
  return canvas.toBuffer('image/png')
}

/**
 * The words on one figure.
 *
 * Returns an empty list rather than throwing. OCR is an enhancement to a guard
 * that already works without it, and a language model that failed to download
 * must not be able to stop a queue — the caller sees "nothing readable", which
 * it already has to handle for figures that carry no writing.
 */
export async function readLabels(png: Buffer): Promise<OcrToken[]> {
  try {
    const worker = await ocrWorker()
    const result = await worker.recognize(await upscale(png), {}, { blocks: true })
    const tokens: OcrToken[] = []
    for (const block of result.data.blocks ?? []) {
      for (const paragraph of block.paragraphs ?? []) {
        for (const line of paragraph.lines ?? []) {
          for (const word of line.words ?? []) {
            if (word.text.trim()) {
              tokens.push({ text: word.text, confidence: word.confidence })
            }
          }
        }
      }
    }
    return tokens
  } catch (error) {
    console.warn(
      `[ocr] could not read a figure: ${error instanceof Error ? error.message : String(error)}`,
    )
    return []
  }
}

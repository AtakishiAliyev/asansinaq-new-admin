import * as pdfjs from 'pdfjs-dist'
// Vite resolves this to a hashed URL for pdf.js's own parser worker.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PDFPageProxy } from 'pdfjs-dist'
import { toast } from 'sonner'
import type { MakeCanvas } from '@/core/segment/crop'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export type { PDFDocumentProxy } from 'pdfjs-dist'

// The exact silent-failure this guards against already happened once: without
// working wasm, pdf.js drops JBIG2/JPX scan layers and pages render with the
// text missing. The probe also catches the SPA-rewrite trap where a missing
// file comes back as 200 + index.html and fools response.ok.
let wasmProbe: Promise<void> | null = null
function probeWasmOnce() {
  wasmProbe ??= (async () => {
    try {
      const res = await fetch('/pdfjs/wasm/jbig2.wasm')
      const head = new Uint8Array(await res.arrayBuffer()).slice(0, 4)
      const isWasm =
        res.ok &&
        head[0] === 0x00 &&
        head[1] === 0x61 &&
        head[2] === 0x73 &&
        head[3] === 0x6d
      if (!isWasm) throw new Error('not wasm')
    } catch {
      console.error(
        'pdfjs wasm faylları çatışmır (/pdfjs/wasm/) — skan kitablar mətnsiz render olunacaq. `npm install` işlədin (scripts/copy-pdfjs-wasm.mjs).',
      )
      toast.warning(
        'Skan dəstəyi natamamdır: pdfjs wasm faylları tapılmadı — skan PDF-lər mətnsiz görünə bilər.',
      )
    }
  })()
}

export async function loadPdf(data: ArrayBuffer) {
  // wasmUrl is load-bearing for scanned books: their text layers are often
  // JBIG2/JPX-compressed, which pdf.js v6 decodes in wasm. The files are
  // copied into public/ by scripts/copy-pdfjs-wasm.mjs (postinstall + build).
  // Node harnesses: see the note in src/core/segment/crop.ts — plain
  // filesystem path, not a file:// URL.
  probeWasmOnce()
  return pdfjs.getDocument({ data, wasmUrl: '/pdfjs/wasm/' }).promise
}

// The browser side of core/segment's injected canvas seam.
export const domCanvas: MakeCanvas = (w, h) => {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  return canvas
}

// Layout detection needs ~1200-1600px of width; more is wasted tokens. The
// scale is derived from a target width rather than fixed, because scan tools
// sometimes write the MediaBox in pixels — a fixed scale would then produce a
// 35M+ px canvas that silently blanks on iOS.
const TARGET_DETECT_WIDTH_PX = 1600

export async function renderPageJpeg(
  page: PDFPageProxy,
): Promise<{ base64: string; mime: 'image/jpeg' }> {
  const base = page.getViewport({ scale: 1 })
  const scale = Math.min(2, TARGET_DETECT_WIDTH_PX / base.width)
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context alınmadı')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvas, viewport }).promise
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
  // toDataURL always yields "data:<mime>;base64,<payload>".
  return { base64: dataUrl.split(',')[1]!, mime: 'image/jpeg' }
}

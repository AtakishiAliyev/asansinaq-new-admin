import * as pdfjs from 'pdfjs-dist'
// Vite resolves this to a hashed URL for pdf.js's own parser worker.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { MakeCanvas } from '@/core/segment/crop'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export type { PDFDocumentProxy } from 'pdfjs-dist'

export async function loadPdf(data: ArrayBuffer) {
  return pdfjs.getDocument({ data }).promise
}

// The browser side of core/segment's injected canvas seam.
export const domCanvas: MakeCanvas = (w, h) => {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  return canvas
}

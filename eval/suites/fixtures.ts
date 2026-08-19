import type { SegItem } from '@/core/segment/types'

// A4 in PDF points — the geometry every fixture below is written against.
export const PAGE_W = 595.28
export const PAGE_H = 841.89

interface TextSpec {
  str: string
  x: number
  y: number
  w?: number
  h?: number
  angle?: number
}

/** Text-layer items as pdf.js hands them over, in top-left coordinates. */
export function items(specs: TextSpec[]): SegItem[] {
  return specs.map((s) => ({
    str: s.str,
    x: s.x,
    yTop: s.y,
    // Roughly a 10pt font: enough for the width-sensitive rules (the bare
    // anchor gate is <24pt, the gutter needs 18pt of clear space).
    w: s.w ?? s.str.length * 5,
    h: s.h ?? 11,
    angle: s.angle ?? 0,
  }))
}

/** One question the way a text layer prints it: fused "N." label + options. */
export function question(n: number, x: number, y: number): TextSpec[] {
  return [
    { str: `${n}. Aşağıdakılardan hansı doğrudur?`, x, y, w: 180 },
    { str: 'A) 1  B) 2  C) 3  D) 4  E) 5', x, y: y + 20, w: 180 },
  ]
}

/** A column of questions starting at `firstNumber`, `gap` points apart. */
export function column(
  firstNumber: number,
  count: number,
  x: number,
  y0: number,
  gap = 150,
): TextSpec[] {
  return Array.from({ length: count }, (_, i) =>
    question(firstNumber + i, x, y0 + i * gap),
  ).flat()
}

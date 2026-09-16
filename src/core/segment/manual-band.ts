// A band the operator drew, made to look like one the segmenter found.
//
// The crop pipeline — render at scale, refine to the ink, classify the figure
// region, cut — takes a `Band`. The segmenter builds one from a page's text
// items by finding the question numbers; a person builds one by dragging a
// rectangle. What the rectangle lacks is the TEXT LAYER: the words inside the
// box, which ride along as the extraction hint and are what a text-only read
// is checked against. So the box is handed the page's items and keeps the
// ones it covers.
//
// "Covers" is by the item's centre, on both axes. The segmenter filters on y
// alone because its box already spans the whole column; a drawn box can be
// narrower than the column, and an item that hangs off its right edge — the
// very "E) 4" a box is being widened to catch — would be lost or kept by the
// accident of where its left edge fell. The centre is the honest test.
//
// Pure, and in core, because the eval pins it and nothing about it needs a
// browser.
import type { Band, SegItem } from '@/core/segment/types'

export interface CropBox {
  x: number
  y: number
  w: number
  h: number
}

/** Whether a stored value is a box: four finite numbers, a positive extent. */
export function isCropBox(value: unknown): value is CropBox {
  if (!value || typeof value !== 'object') return false
  const b = value as Record<string, unknown>
  return (
    ['x', 'y', 'w', 'h'].every((k) => typeof b[k] === 'number' && Number.isFinite(b[k])) &&
    (b.w as number) > 0 &&
    (b.h as number) > 0
  )
}

/**
 * The band for a drawn box.
 *
 * `anchorYTop` is the box's own top: the ink refiner measures downward from
 * the question number's line, and a person's box starts where they put it.
 */
export function bandFromBox(
  items: readonly SegItem[],
  box: CropBox,
  number: number,
  col: number,
): Band {
  const inside = items
    .filter((it) => {
      const cx = it.x + it.w / 2
      const cy = it.yTop + it.h / 2
      return cx >= box.x && cx <= box.x + box.w && cy >= box.y && cy <= box.y + box.h
    })
    .sort((p, q) => p.yTop - q.yTop || p.x - q.x)
  return {
    number,
    col,
    bbox: { x: box.x, y: box.y, w: box.w, h: box.h },
    anchorYTop: box.y,
    textLayer: inside
      .map((it) => it.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim(),
  }
}

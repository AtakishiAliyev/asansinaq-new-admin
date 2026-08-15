// Shared contract of the segmentation pipeline. Both front ends (text-layer
// path here, the AI scan path later) emit the same Band/PageSeg shapes, so
// cropping and everything downstream is written once.

export interface SegItem {
  str: string
  x: number // left, PDF points, top-left origin
  yTop: number
  w: number
  h: number
  angle: number // radians; rotated items are watermark suspects
}

export interface Band {
  number: number
  col: number
  bbox: { x: number; y: number; w: number; h: number } // PDF points, top-left origin
  anchorYTop: number // y of the printed question-number token; the ink refiner cuts relative to it
  textLayer: string
}

export interface PageSeg {
  pageNumber: number
  width: number
  height: number
  testNo?: number
  bands: Band[]
  notes: string[]
  isScan: boolean // true → no usable text layer; page needs the AI scan path
}

// Publisher-specific overrides. Everything has a generic default; a profile
// only pins down what auto-detection cannot know for a stubborn book.
export interface SourceProfile {
  /** Items rotated beyond this (rad) are treated as watermark. */
  watermarkAngle: number
  /** Optional extra watermark text pattern (word-boundary), any small rotation. */
  watermarkPattern?: RegExp
  /** Pattern that extracts a test/section number from the page top, for metadata. */
  headerPattern?: RegExp
  /** Height (pt) of the bottom strip reserved for the printed page number. */
  footerPt: number
  /** Max distance (pt) an anchor may sit right of the column's left edge. */
  anchorIndentPt: number
  /** Highest question number a page can plausibly start. */
  maxQuestionNumber: number
  /** Minimum x-gap (pt) between text blocks that counts as a column gutter. */
  minGutterPt: number
  /** Fewer text items than this → the page is treated as a scan. */
  minTextItems: number
}

export const DEFAULT_PROFILE: SourceProfile = {
  watermarkAngle: 0.09, // ~5°
  headerPattern: /test\s*[-–]?\s*(\d+)/i,
  footerPt: 40,
  anchorIndentPt: 16,
  maxQuestionNumber: 99,
  minGutterPt: 18,
  minTextItems: 8,
}

export type FigureKind = 'colored' | 'rule' | 'none'

export interface Crop {
  number: number
  col: number
  pageNumber: number
  dataUrl: string // for on-screen display
  figureKind: FigureKind
}

export interface CropResult {
  crops: Crop[]
  notes: string[]
}

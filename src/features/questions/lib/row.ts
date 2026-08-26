import type { FigureDoc } from '@/core/figures/figspec'
import type { Flag } from '@/core/questions/lint'
import type { QuestionRow } from '@/features/questions/schemas'

// jsonb columns arrive as unknown; these readers keep the narrowing in one
// place instead of casting at every call site.

export interface RowOption {
  label: string
  tex?: string
  image?: string
}

export function parseOptions(value: unknown): RowOption[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (o): o is RowOption =>
      typeof o === 'object' && o !== null && typeof (o as RowOption).label === 'string',
  )
}

export function parseFlags(value: unknown): Flag[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (f): f is Flag =>
      typeof f === 'object' &&
      f !== null &&
      typeof (f as Flag).code === 'string' &&
      ((f as Flag).level === 'error' || (f as Flag).level === 'warning'),
  )
}

export function parseFigures(value: unknown): FigureDoc | null {
  if (!value || typeof value !== 'object') return null
  const doc = value as FigureDoc
  return Array.isArray(doc.items) ? doc : null
}

/** Every storage path a row needs signed to render (crop + generated images). */
export function imagePathsOf(row: QuestionRow): string[] {
  const paths = [row.crop_path]
  for (const o of parseOptions(row.options)) {
    if (o.image && !o.image.startsWith('data:')) paths.push(o.image)
  }
  const figures = parseFigures(row.figures)
  for (const item of figures?.items ?? []) {
    if (item.kind !== 'image') continue
    if (!item.src.startsWith('data:')) paths.push(item.src)
    // The guarded reproduction as well as the cut: the review screen shows the
    // reproduction and needs the cut beside it to judge against.
    if (item.genSrc && !item.genSrc.startsWith('data:')) paths.push(item.genSrc)
  }
  return paths
}

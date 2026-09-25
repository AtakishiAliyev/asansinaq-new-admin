import type { FigureDoc } from '@/core/figures/figspec'
import { parseFigures, parseOptions } from '@/features/questions'
import type {
  draftRowSchema,
  searchRowSchema,
  BuilderQuestion,
} from '@/features/exams/schemas'
import type { z } from 'zod'

// The two RPCs the builder reads return the bank's columns raw; this is the
// one place they become a `BuilderQuestion`.

export function fromSearchRow(
  row: z.infer<typeof searchRowSchema>,
): BuilderQuestion {
  return {
    id: row.id,
    categoryId: row.category_id,
    difficulty: row.difficulty,
    stem: row.stem ?? '',
    options: parseOptions(row.options),
    answer: row.answer,
    figures: parseFigures(row.figures),
    usageCount: row.usage_count,
    source: { bookId: row.book_id, page: row.page_number, qNo: row.q_no },
  }
}

export function fromDraftRow(
  row: z.infer<typeof draftRowSchema>,
): BuilderQuestion {
  return {
    id: row.question_id,
    categoryId: row.category_id,
    difficulty: row.difficulty,
    stem: row.stem ?? '',
    options: parseOptions(row.options),
    answer: row.answer,
    figures: parseFigures(row.figures),
    usageCount: row.usage_count,
    status: row.status,
    changedSincePublish: row.changed_since_publish,
  }
}

export function hasFigures(doc: FigureDoc | null): doc is FigureDoc {
  return Boolean(doc?.items.length)
}

/** The storage path a figure image is DISPLAYED from: the reproduction when
 *  there is one, the cut otherwise — the same rule the renderer applies. */
function shownPath(item: FigureDoc['items'][number]): string | null {
  if (item.kind !== 'image') return null
  return item.genSrc || item.src || null
}

/** A value that is a path in the private bucket, as against an inline
 *  data URL or an absolute URL, which need no signing and no copying. */
export function isStoragePath(value: string): boolean {
  return !/^(data:|https?:)/.test(value)
}

/** Every private image a question needs signed to be shown. */
export function imagePathsOf(
  q: Pick<BuilderQuestion, 'figures' | 'options'>,
): string[] {
  const paths: string[] = []
  for (const item of q.figures?.items ?? []) {
    const p = shownPath(item)
    if (p && isStoragePath(p)) paths.push(p)
  }
  for (const o of q.options)
    if (o.image && isStoragePath(o.image)) paths.push(o.image)
  return paths
}

export { shownPath }

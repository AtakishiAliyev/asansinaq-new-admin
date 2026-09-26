import type { FigItem } from '@/core/figures/figspec'
import { renderFigureDoc } from '@/core/figures/render'
import { supabase } from '@/lib/supabase'
import type { BuilderQuestion } from '@/features/exams/schemas'
import {
  hasFigures,
  isStoragePath,
  shownPath,
} from '@/features/exams/lib/question'

const SOURCE_BUCKET = 'question-crops'
const TARGET_BUCKET = 'exam-assets'
const PARALLEL = 4

// Type aliases, not interfaces, so the map is assignable to the generated
// `Json` parameter of `exam_publish` without a cast.
export type QuestionAssets = {
  figures?: { direction: 'row' | 'column'; svgs: string[] }
  options?: Record<string, string>
}
export type AssetMap = Record<string, QuestionAssets>

// What a published version needs that only the browser can make.
//
// The student app has no figure renderer and cannot read the private crop
// bucket, so a version carries each figure plate as finished SVG and each
// picture as a PUBLIC url. Every image is copied into `exam-assets` under a
// path unique to THIS publish: a version's pictures must never change after
// it goes out, and a crop that is later re-cut in place would otherwise
// change the picture under every version that pointed at it.
export async function buildPublishAssets(
  /** The exam's id — or any other scope, for a roadmap's publish. */
  examId: number | string,
  questions: BuilderQuestion[],
  onProgress?: (done: number, total: number) => void,
): Promise<AssetMap> {
  const stamp = Date.now().toString(36)
  const jobs = questions.filter(
    (q) => hasFigures(q.figures) || q.options.some((o) => o.image),
  )
  const assets: AssetMap = {}
  let done = 0
  onProgress?.(0, jobs.length)

  const run = async (q: BuilderQuestion) => {
    const prefix = `v/${examId}/${stamp}/${q.id}`
    const entry: QuestionAssets = {}

    if (hasFigures(q.figures)) {
      const items: FigItem[] = []
      for (const [i, item] of q.figures.items.entries()) {
        const path = shownPath(item)
        if (item.kind === 'image' && path) {
          const url = await publishImage(path, `${prefix}/fig-${i}`)
          // The copy is what is shown now; the cut/reproduction split is a
          // bank concern that does not travel into a version.
          items.push({ ...item, src: url, genSrc: undefined })
        } else {
          items.push(item)
        }
      }
      entry.figures = {
        direction: q.figures.layout?.direction === 'column' ? 'column' : 'row',
        // A per-question prefix: many plates share one student page, and SVG
        // ids (masks, markers) must not collide across them.
        svgs: renderFigureDoc(
          { ...q.figures, items },
          { idPrefix: `q${q.id}` },
        ),
      }
    }

    const optionUrls: Record<string, string> = {}
    for (const o of q.options) {
      if (o.image)
        optionUrls[o.label] = await publishImage(
          o.image,
          `${prefix}/opt-${o.label}`,
        )
    }
    if (Object.keys(optionUrls).length) entry.options = optionUrls

    assets[String(q.id)] = entry
    done += 1
    onProgress?.(done, jobs.length)
  }

  for (let i = 0; i < jobs.length; i += PARALLEL) {
    await Promise.all(jobs.slice(i, i + PARALLEL).map(run))
  }
  return assets
}

async function publishImage(source: string, destBase: string): Promise<string> {
  if (/^https?:/.test(source)) return source

  if (source.startsWith('data:')) {
    const blob = await (await fetch(source)).blob()
    const dest = `${destBase}.${extensionOf(blob.type)}`
    const { error } = await supabase.storage
      .from(TARGET_BUCKET)
      .upload(dest, blob, { contentType: blob.type, upsert: true })
    if (error) throw error
    return publicUrl(dest)
  }

  if (!isStoragePath(source))
    throw new Error(`Tanınmayan şəkil mənbəyi: ${source}`)
  const dest = `${destBase}.${source.split('.').pop() ?? 'png'}`
  const { error } = await supabase.storage
    .from(SOURCE_BUCKET)
    .copy(source, dest, { destinationBucket: TARGET_BUCKET })
  // The path is unique to this publish, so "already exists" can only be a
  // retry of this same publish, and the object there is the one we want.
  if (error && !/exist/i.test(error.message)) throw error
  return publicUrl(dest)
}

function publicUrl(path: string): string {
  return supabase.storage.from(TARGET_BUCKET).getPublicUrl(path).data.publicUrl
}

function extensionOf(mime: string): string {
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/webp') return 'webp'
  return 'png'
}

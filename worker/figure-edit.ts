// A corrective edit of a reproduction the verifier faulted.
//
// The verification wave compares our render — which on a `gen` book shows the
// reproduction — against the crop. When its complaint is about the drawing,
// the drawing is what has to change, and the cheapest way to change it is to
// hand the image model the cut, the drawing and the complaint, and ask for
// exactly that fixed. This runs that round: it fetches both pictures, picks
// the provider the schedule names for this round, stores the edited drawing
// beside the earlier ones, judges it with the same guard the first drawing
// met, and writes what the reviewer should know onto the figure.
//
// It never decides whether an edit SHOULD happen — that is `applyVerdict`,
// reading MAX_GEN_EDITS — and it never touches the cut, which stays the
// source of truth under every version.
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { pickEditProvider, parseProviderOrder, type GenProvider } from '@/core/figures/gen-policy'
import type { ImageFig } from '@/core/figures/figspec'
import { extensionForMime, sniffImageMime } from '@/core/figures/image-mime'
import { figureImagePath } from '@/core/questions/image-paths'
import type { Pixels } from '@/core/segment/image-clean'
import { config } from './config.ts'
import type { Db, QuestionRow } from './db.ts'
import { availableProviders, editFigure, judgeDrawing, providerModel } from './figure-gen.ts'
import { loadSignature, storeSignature } from './signature-store.ts'
import { budgetExhausted, logOp } from './ops.ts'

/** Where edit round `round` (1-based) of a figure's reproduction lives. */
export function figureEditPath(row: QuestionRow, index: number, round: number, ext: string): string {
  return figureImagePath(row, index).replace(/\.png$/, `.gen${round}.${ext}`)
}

async function decode(image: Buffer): Promise<Pixels | null> {
  try {
    const img = await loadImage(image)
    const canvas = createCanvas(img.width, img.height)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const raw = ctx.getImageData(0, 0, img.width, img.height)
    return { data: raw.data, width: img.width, height: img.height }
  } catch {
    return null
  }
}

async function download(db: Db, path: string): Promise<Buffer | null> {
  const { data, error } = await db.storage.from('question-crops').download(path)
  if (error || !data) return null
  return Buffer.from(await data.arrayBuffer())
}

export interface EditOutcome {
  /** The edited drawing's path, when one was produced and stored. */
  path?: string
  provider?: GenProvider
  /** The guard's objection to the edited drawing, when it had one. */
  rejection?: string
  /** Why no edit was produced at all. */
  failure?: string
}

/** The provider the schedule names for this round, or null when none can. */
export function editProviderFor(round: number): GenProvider | null {
  return pickEditProvider(round, parseProviderOrder(config.FIGURE_EDIT_PROVIDERS), availableProviders())
}

export async function editReproduction(
  db: Db,
  row: QuestionRow,
  index: number,
  item: ImageFig,
  findings: string,
  /** The current drawing's thought signature, when the caller already has it;
   *  otherwise it is read from the sidecar beside that drawing. */
  knownSignature?: string,
): Promise<EditOutcome> {
  const round = item.genRound ?? 0
  const provider = editProviderFor(round)
  if (!provider) return { failure: 'heç bir şəkil provayderi konfiqurasiya olunmayıb' }
  if (!item.src || !item.genSrc) return { failure: 'kəsim və ya təkrar çəkiliş yoxdur' }
  if (await budgetExhausted(db).catch(() => true)) return { failure: 'günlük büdcə dolub' }

  const [cut, current] = await Promise.all([download(db, item.src), download(db, item.genSrc)])
  if (!cut || !current) return { failure: 'kəsim və ya təkrar çəkiliş yüklənmədi' }

  // A signature belongs to the turn that produced it, so it is passed back
  // only to the provider that issued it.
  const signature =
    provider === 'gemini'
      ? (knownSignature ?? (await loadSignature(db, item.genSrc).catch(() => undefined)))
      : undefined

  const started = Date.now()
  const result = await editFigure(provider, cut, current, findings, signature)
  await logOp(db, {
    op: `figure_edit_${provider}`,
    model: providerModel(provider),
    usage: { input: result.usage.input, cacheWrite: 0, cacheRead: 0, output: result.usage.output },
    viaBatch: false,
    cached: false,
    ms: Date.now() - started,
  }).catch(() => {})
  if (!result.png) {
    // Said in the log as well as on the row: an edit that fails on every call
    // is a misconfigured provider, and the row's flag alone does not show
    // that it is EVERY call.
    console.warn(`[q${row.id}] figure ${index} edit via ${provider} failed: ${result.error ?? 'no image'}`)
    return { provider, failure: result.error ?? 'şəkil qaytarılmadı' }
  }

  const mime = sniffImageMime(result.png)
  if (!mime) return { provider, failure: 'qaytarılan şəklin formatı tanınmadı' }
  const path = figureEditPath(row, index, round + 1, extensionForMime(mime))
  const { error } = await db.storage
    .from('question-crops')
    .upload(path, result.png, { upsert: true, contentType: mime })
  if (error) return { provider, failure: `saxlanıla bilmədi: ${error.message}` }
  // The edited drawing has a signature of its own; a further round amends THAT.
  await storeSignature(db, path, result.signature)

  const cutPixels = await decode(cut)
  const judged = cutPixels ? await judgeDrawing(cut, cutPixels, result.png, decode) : null
  return {
    path,
    provider,
    ...(judged && !judged.passed ? { rejection: judged.rejection ?? 'quruluş yoxlamasından keçmədi' } : {}),
  }
}

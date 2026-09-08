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
import { decideDrawing } from '@/core/figures/drawing-choice'
import {
  MAX_GEN_EDITS,
  pickEditProvider,
  parseProviderOrder,
  type GenProvider,
} from '@/core/figures/gen-policy'
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
function figureEditPath(row: QuestionRow, index: number, round: number, ext: string): string {
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
  /** The edited drawing's path, when one was produced AND measured better than
   *  the drawing it was asked to fix. */
  path?: string
  provider?: GenProvider
  /** The guard's objection to the edited drawing, when it had one. */
  rejection?: string
  /** Why no edit was produced, or why the one produced was not taken. */
  failure?: string
  /** True when an edit was drawn and then rejected as no improvement. The
   *  caller keeps the drawing it already had, and the row says so. */
  discarded?: boolean
}

/** The provider the schedule names for this ATTEMPT, or null when none can. */
export function editProviderFor(attempt: number): GenProvider | null {
  return pickEditProvider(
    attempt,
    parseProviderOrder(config.FIGURE_EDIT_PROVIDERS),
    availableProviders(),
  )
}

/**
 * Try a provider, and move the schedule on whatever it returns.
 *
 * The point of a second provider is that it is a DIFFERENT model, and it was
 * once unreachable: the schedule was walked by ACCEPTED rounds, so a first
 * edit that came back no better left the counter at zero and the next try went
 * to the model that had just failed. On that run the second provider never
 * drew a single figure. Every attempt advances the counter now, which is what
 * fixed it.
 *
 * What it does NOT do is spend the whole schedule in one pass. A provider that
 * ERRORED said nothing about the figure, so the next one is tried immediately.
 * A provider whose drawing was DISCARDED did answer, and its answer was not an
 * improvement; the loop stops there and lets a later verification round decide
 * whether the figure is still worth a second model. See the note at the break.
 */
export async function editUntilBetter(
  db: Db,
  row: QuestionRow,
  index: number,
  item: ImageFig,
  findings: string,
  signature?: string,
): Promise<EditOutcome & { attempts: number }> {
  let attempt = item.genEditAttempts ?? 0
  let last: EditOutcome = { failure: 'heç bir cəhd edilmədi' }
  const tried: string[] = []
  while (attempt < MAX_GEN_EDITS) {
    const provider = editProviderFor(attempt)
    if (!provider) break
    last = await editReproduction(db, row, index, item, findings, {
      attempt,
      // A signature belongs to the drawing it was issued for, so it is only
      // ever offered to the first attempt on that drawing.
      signature: tried.length ? undefined : signature,
    })
    attempt++
    tried.push(provider)
    if (last.path) return { ...last, attempts: attempt }
    // A DISCARDED edit ends this pass. The drawing came back and measured no
    // better than the one it was asked to fix, which is a different event from
    // a provider that errored: the model answered, and the answer was not an
    // improvement. Handing that straight to the next provider spent the most
    // expensive call in the lane on the same figure seconds later, and on the
    // operator's first two banks it never once produced a kept drawing.
    //
    // The counter still advances, so the next provider is not lost — a later
    // verification round reaches it if the figure is still faulted then. That
    // is the difference from the bug this loop was written to fix: the
    // schedule stalled at zero and the second model was unreachable for ever.
    // Here it is merely not bought twice in one breath.
    if (last.discarded) break
  }
  return {
    ...last,
    attempts: attempt,
    failure: last.failure
      ? `${last.failure}${tried.length > 1 ? ` (cəhd olunan: ${tried.join(', ')})` : ''}`
      : last.failure,
  }
}

async function editReproduction(
  db: Db,
  row: QuestionRow,
  index: number,
  item: ImageFig,
  findings: string,
  options: {
    /** Which attempt this is; it decides which provider draws. */
    attempt: number
    /** The current drawing's thought signature, when the caller already has
     *  it; otherwise it is read from the sidecar beside that drawing. */
    signature?: string
  },
): Promise<EditOutcome> {
  const { attempt, signature: knownSignature } = options
  const provider = editProviderFor(attempt)
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
  const path = figureEditPath(row, index, attempt + 1, extensionForMime(mime))
  const { error } = await db.storage
    .from('question-crops')
    .upload(path, result.png, { upsert: true, contentType: mime })
  if (error) return { provider, failure: `saxlanıla bilmədi: ${error.message}` }
  // The edited drawing has a signature of its own; a further round amends THAT.
  await storeSignature(db, path, result.signature)

  // BOTH drawings are measured against the same cut, and the better one wins.
  // Taking the edit on trust is what made five of five reviewed figures worse
  // than the pictures they replaced — see core/figures/drawing-choice.ts.
  const cutPixels = await decode(cut)
  const judgedNew = cutPixels ? await judgeDrawing(cut, cutPixels, result.png, decode) : null
  const judgedOld = cutPixels ? await judgeDrawing(cut, cutPixels, current, decode) : null
  const choice = decideDrawing(judgedOld?.diff ?? null, judgedNew?.diff ?? null)
  if (!choice.keepNew) {
    console.warn(`[q${row.id}] figure ${index} edit discarded: ${choice.reason}`)
    return { provider, discarded: true, failure: choice.reason }
  }
  return {
    path,
    provider,
    ...(judgedNew && !judgedNew.passed
      ? { rejection: judgedNew.rejection ?? 'quruluş yoxlamasından keçmədi' }
      : {}),
  }
}

// The guarded figure-reproduction lane.
//
// A generation is never displayed on the strength of looking good. It is drawn
// FROM the cleaned cut, compared BACK to that cut, and shown only if the
// comparison holds — with the cut kept as the source of truth either way, so
// there is always something faithful to fall back to and to review against.
//
// The provider is reached over plain HTTPS rather than through an SDK. The one
// thing needed here is a POST with an image and a prompt, and a dependency that
// has to be approved, versioned and audited is a poor trade for a fetch call.
import {
  FIGURE_REPRODUCE_PROMPT,
  figureEditFollowUpPrompt,
  figureEditPrompt,
} from '@/core/extract/figure-gen-prompt'
import {
  drawContents,
  editContents,
  geminiBody,
  refusedImageConfig,
  withoutImageConfig,
  type GenContents,
  type GenImage,
} from '@/core/figures/gen-request'
import type { GenProvider } from '@/core/figures/gen-policy'
import { compareLabels, type LabelDiff } from '@/core/figures/labels'
import { compareStructure, type StructuralDiff } from '@/core/figures/structural-diff'
import { readLabels } from './figure-ocr.ts'
import type { Pixels } from '@/core/segment/image-clean'
import { config } from './config.ts'

export const FIGURE_GEN_OP = 'figure_gen_gemini'

export interface GenerationResult {
  /** PNG bytes of the reproduction, or null when the provider returned none. */
  png: Buffer | null
  error?: string
  /**
   * The thought signature the model returned on the image part, when it did.
   *
   * Kept because a corrective edit is a CONTINUATION of the turn that drew the
   * figure, and the docs require the signature to be passed back exactly as
   * received or the next response may fail. Without it an edit falls back to
   * handing the model two anonymous pictures, which is the shape that was
   * moving shaded regions. Only Gemini returns one.
   */
  signature?: string
  /** What the call cost, for the ledger. */
  usage: { input: number; output: number }
}

/**
 * Ask the provider for a reproduction of one cut.
 *
 * Returns rather than throws on a provider error: a figure that could not be
 * regenerated must fall back to its cut, not fail the question. The whole lane
 * is an enhancement over something that already works.
 */
async function reproduceFigure(cutPng: Buffer): Promise<GenerationResult> {
  return geminiCall(drawContents([asGenImage(cutPng)], FIGURE_REPRODUCE_PROMPT))
}

/** Which providers have a key AND a model id in this worker's environment. */
export function availableProviders(): GenProvider[] {
  const out: GenProvider[] = []
  if (config.GEMINI_API_KEY && config.GEMINI_IMAGE_MODEL) out.push('gemini')
  if (config.OPENAI_API_KEY && config.OPENAI_IMAGE_MODEL) out.push('openai')
  return out
}

/** The model id a provider draws with, for the ledger. */
export function providerModel(provider: GenProvider): string {
  return (provider === 'gemini' ? config.GEMINI_IMAGE_MODEL : config.OPENAI_IMAGE_MODEL) ?? `${provider}(unset)`
}

/**
 * A corrective edit: the cut, the faulted drawing and the verifier's words go
 * to the provider, which returns the drawing with those faults fixed.
 *
 * Returns rather than throws, like `reproduceFigure`: an edit that could not
 * be made leaves the caller to decide what is shown, and that is not a reason
 * to fail a question.
 */
export async function editFigure(
  provider: GenProvider,
  cutPng: Buffer,
  currentImage: Buffer,
  findings: string,
  /** The signature the drawing came back with, when it is Gemini's own. */
  signature?: string,
): Promise<GenerationResult> {
  if (provider === 'openai') return openaiEdit([cutPng, currentImage], figureEditPrompt(findings))

  // The documented path: amend the model's own last output, with the reasoning
  // that produced it still attached. Available only when the drawing came from
  // this provider, its signature was kept, and the operator has turned the
  // shape on — see FIGURE_EDIT_MULTITURN for why it is off by default.
  if (signature && config.FIGURE_EDIT_MULTITURN) {
    const continued = await geminiCall(
      editContents({
        cut: asGenImage(cutPng),
        drawPrompt: FIGURE_REPRODUCE_PROMPT,
        drawing: asGenImage(currentImage),
        signature,
        followUp: figureEditFollowUpPrompt(findings),
      }),
    )
    if (continued.png) return continued
    // A signature the model will not accept — stale, or from another model id
    // after the operator switched tiers — is a documented way for this call to
    // fail. Falling back costs one more call and keeps the round alive.
    console.warn(`[figure] multi-turn edit refused, falling back to a flat edit: ${continued.error}`)
  }
  return geminiCall(
    drawContents([asGenImage(cutPng), asGenImage(currentImage)], figureEditPrompt(findings)),
  )
}

/** A buffer as the API takes it, its type read from the bytes rather than a name. */
function asGenImage(image: Buffer): GenImage {
  return { data: image.toString('base64'), mimeType: sniffMime(image) }
}

/**
 * One call to the image model.
 *
 * The resolution request is optional configuration, and `imageConfig` is
 * documented to error on a model that does not support it — so a refusal that
 * names the field is retried once without it rather than losing the drawing.
 */
async function geminiCall(contents: GenContents): Promise<GenerationResult> {
  if (!config.GEMINI_API_KEY || !config.GEMINI_IMAGE_MODEL) {
    return { png: null, error: 'no Gemini key or model configured', usage: { input: 0, output: 0 } }
  }
  const body = geminiBody(contents, { imageSize: config.GEMINI_IMAGE_SIZE })
  const first = await postGemini(body)
  if (first.refusedConfig && config.GEMINI_IMAGE_SIZE) {
    console.warn(
      `[figure] ${config.GEMINI_IMAGE_MODEL} refused imageSize=${config.GEMINI_IMAGE_SIZE}; ` +
        'retrying at the default resolution. Unset GEMINI_IMAGE_SIZE to stop paying for this retry.',
    )
    return (await postGemini(withoutImageConfig(body))).result
  }
  return first.result
}

async function postGemini(
  body: Record<string, unknown>,
): Promise<{ result: GenerationResult; refusedConfig: boolean }> {
  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(config.GEMINI_IMAGE_MODEL!)}:generateContent`

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': config.GEMINI_API_KEY!,
      },
      body: JSON.stringify(body),
      // A drawing that never comes back must not hold an express slot for ever.
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    })
  } catch (error) {
    return {
      result: { png: null, error: `request failed: ${String(error)}`, usage: { input: 0, output: 0 } },
      refusedConfig: false,
    }
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    return {
      result: {
        png: null,
        error: `provider ${response.status}: ${text.slice(0, 300)}`,
        usage: { input: 0, output: 0 },
      },
      refusedConfig: refusedImageConfig(response.status, text),
    }
  }

  const json = (await response.json()) as {
    candidates?: {
      content?: {
        parts?: {
          inlineData?: { data?: string }
          inline_data?: { data?: string }
          thoughtSignature?: string
          thought_signature?: string
        }[]
      }
    }[]
    usageMetadata?: {
      promptTokenCount?: number
      candidatesTokenCount?: number
      thoughtsTokenCount?: number
    }
  }
  const parts = json.candidates?.[0]?.content?.parts ?? []
  const image = parts.find((p) => p.inlineData?.data || p.inline_data?.data)
  const base64 = image?.inlineData?.data ?? image?.inline_data?.data
  const usage = {
    input: json.usageMetadata?.promptTokenCount ?? 0,
    // Thinking is on by default for this model family and cannot be turned
    // off, and its tokens ARE billed. Counting only the candidate tokens made
    // the ledger a floor rather than the bill.
    output:
      (json.usageMetadata?.candidatesTokenCount ?? 0) +
      (json.usageMetadata?.thoughtsTokenCount ?? 0),
  }
  if (!base64) {
    // A text-only answer is the provider declining to draw, and that is a
    // rejection rather than an error worth retrying differently.
    const said = parts.map((p) => (p as { text?: string }).text ?? '').join(' ').slice(0, 200)
    return {
      result: { png: null, error: `no image returned${said ? `: ${said}` : ''}`, usage },
      refusedConfig: false,
    }
  }
  const signature = image?.thoughtSignature ?? image?.thought_signature
  return {
    result: { png: Buffer.from(base64, 'base64'), usage, ...(signature ? { signature } : {}) },
    refusedConfig: false,
  }
}

/** JPEG or PNG, from the bytes — the provider is told what it is handed. */
function sniffMime(image: Buffer): 'image/png' | 'image/jpeg' {
  return image[0] === 0xff && image[1] === 0xd8 ? 'image/jpeg' : 'image/png'
}

/**
 * How long any one drawing may take.
 *
 * Both providers document that a complex prompt can run to about two minutes,
 * and an express slot is held for the whole of it. Without a timeout a hung
 * call holds that slot until the process is killed.
 */
const PROVIDER_TIMEOUT_MS = 180_000

/**
 * The OpenAI images edit endpoint: the reference images and the brief go as
 * a multipart form, the drawing comes back base64. Model id from config, as
 * everywhere; the request shape is the documented one and carries nothing
 * model-specific.
 */
async function openaiEdit(images: Buffer[], prompt: string): Promise<GenerationResult> {
  if (!config.OPENAI_API_KEY || !config.OPENAI_IMAGE_MODEL) {
    return { png: null, error: 'no OpenAI key or model configured', usage: { input: 0, output: 0 } }
  }
  const form = new FormData()
  form.append('model', config.OPENAI_IMAGE_MODEL)
  form.append('prompt', prompt)
  // Quality outranks cost here by the operator's own rule, and the lane only
  // reaches this provider on a round that already has a defect to fix.
  form.append('quality', 'high')
  // PNG, opaque, both deliberate. The guard reads luminance and saturation off
  // RGB and never looks at alpha, so a transparent background — which this
  // provider may choose on its own under the default `auto` — would decode as
  // (0,0,0,0) and be counted as ink over the whole image, rejecting a perfect
  // drawing for a reason nothing would name. PNG keeps thin lines lossless.
  form.append('background', 'opaque')
  form.append('output_format', 'png')
  images.forEach((img, i) => {
    const mime = sniffMime(img)
    form.append('image[]', new Blob([new Uint8Array(img)], { type: mime }), `image${i + 1}.${mime === 'image/jpeg' ? 'jpg' : 'png'}`)
  })

  let response: Response
  try {
    response = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { authorization: `Bearer ${config.OPENAI_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    })
  } catch (error) {
    return { png: null, error: `request failed: ${String(error)}`, usage: { input: 0, output: 0 } }
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    return {
      png: null,
      error: `provider ${response.status}: ${body.slice(0, 300)}`,
      usage: { input: 0, output: 0 },
    }
  }
  const json = (await response.json()) as {
    data?: { b64_json?: string }[]
    usage?: { input_tokens?: number; output_tokens?: number }
  }
  const base64 = json.data?.[0]?.b64_json
  const usage = { input: json.usage?.input_tokens ?? 0, output: json.usage?.output_tokens ?? 0 }
  if (!base64) return { png: null, error: 'no image returned', usage }
  return { png: Buffer.from(base64, 'base64'), usage }
}

export interface Judgement {
  passed: boolean
  diff: StructuralDiff
  labels: LabelDiff | null
  rejection: string | null
}

/**
 * The guard, applied to ONE drawing: structure against the cut, then the
 * writing if the structure held. Shared by the first drawing and every edit,
 * so a reviewer reads the same objection whoever drew the picture.
 */
export async function judgeDrawing(
  cutPng: Buffer,
  cutPixels: Pixels,
  drawing: Buffer,
  decode: (png: Buffer) => Promise<Pixels | null>,
): Promise<Judgement | null> {
  const generated = await decode(drawing)
  if (!generated) return null
  const diff = compareStructure(cutPixels, generated)
  let labels: LabelDiff | null = null
  if (diff.passed) labels = compareLabels(await readLabels(cutPng), await readLabels(drawing))
  const passed = diff.passed && Boolean(labels?.passed)
  const rejection = passed
    ? null
    : [...diff.reasons, ...(labels && !labels.passed ? [`yazı itib: ${labels.missing.join(', ')}`] : [])].join('; ')
  return { passed, diff, labels, rejection }
}

export interface GuardedGeneration {
  png: Buffer | null
  diff: StructuralDiff | null
  /** The writing check, when the structure check got far enough to run it. */
  labels: LabelDiff | null
  attempts: number
  /** Why the cut is being kept, when it is. */
  rejection?: string
  /**
   * The last image the guard REFUSED, kept for review only.
   *
   * Separate from `png` on purpose: a rejected reproduction must be impossible
   * to hand to the pipeline by accident, and equally must not be thrown away —
   * the whole question a reviewer asks about a rejection is "what did it
   * actually draw", and the first version of the sample page answered that with
   * a line of error text.
   */
  rejectedPng?: Buffer
  /** The accepted drawing's thought signature, for a later corrective edit. */
  signature?: string
  usage: { input: number; output: number }
}

/**
 * Generate, then judge, then generate once more if the judgement failed.
 *
 * One retry, because the second attempt is cheap relative to a reviewer's time
 * and reproduction failures are often one-off, and NOT a third, because a model
 * that has now drawn the same figure wrongly twice is not going to be argued
 * into it on the next pass.
 */
export async function guardedReproduction(
  cutPng: Buffer,
  cutPixels: Pixels,
  decode: (png: Buffer) => Promise<Pixels | null>,
): Promise<GuardedGeneration> {
  let lastRejection = 'no attempt made'
  let lastDiff: StructuralDiff | null = null
  let lastLabels: LabelDiff | null = null
  let lastRefused: Buffer | null = null
  let lastSignature: string | undefined
  const usage = { input: 0, output: 0 }

  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await reproduceFigure(cutPng)
    usage.input += result.usage.input
    usage.output += result.usage.output
    if (!result.png) {
      lastRejection = result.error ?? 'no image returned'
      continue
    }
    const generated = await decode(result.png)
    if (!generated) {
      lastRejection = 'the generated image could not be decoded'
      continue
    }
    const diff = compareStructure(cutPixels, generated)
    lastDiff = diff

    // The writing is read only when the drawing already holds up. OCR is the
    // slow part of this lane by an order of magnitude, and a reproduction that
    // moved a shaded region is going back regardless of what it says.
    let labels: LabelDiff | null = null
    if (diff.passed) {
      labels = compareLabels(await readLabels(cutPng), await readLabels(result.png))
      lastLabels = labels
    }

    if (diff.passed && labels?.passed) {
      return {
        png: result.png,
        diff,
        labels,
        attempts: attempt,
        usage,
        ...(result.signature ? { signature: result.signature } : {}),
      }
    }
    lastRejection = [
      ...diff.reasons,
      ...(labels && !labels.passed
        ? [`yazı itib: ${labels.missing.join(', ')}`]
        : []),
    ].join('; ')
    lastRefused = result.png
    lastSignature = result.signature
  }

  return {
    png: null,
    diff: lastDiff,
    labels: lastLabels,
    attempts: 2,
    rejection: lastRejection,
    rejectedPng: lastRefused ?? undefined,
    // Carried even for a REFUSED drawing: that drawing is what gets displayed
    // and what an edit round amends, so it needs its signature too.
    ...(lastSignature ? { signature: lastSignature } : {}),
    usage,
  }
}

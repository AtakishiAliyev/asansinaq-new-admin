// The Gemini image request, as a shape rather than a call.
//
// Pure and in core for the reason `pace.ts` is: the eval harness must run free
// and offline, and importing the worker's HTTP layer drags in
// `worker/config.ts`, which refuses to load without a service key. The request
// SHAPE is exactly the part worth pinning — three of its details are decisions
// taken against documentation rather than defaults, and a silent regression in
// any of them costs money and quality without failing anything.
//
// The three:
//
// RESOLUTION IS ASKED FOR. Left unset, the API draws at 1K, and both image
// model cards name that size in their own list of known limitations: "text
// rendering: poor in small text (often blurry in 1k model)". Exam figures are
// small labels on thin lines, which is precisely that case. On the pro image
// tier 1K and 2K are billed the same 1,120 output tokens, so the resolution is
// free there; on the flash tier it is roughly half as much again per drawing.
//
// TEMPERATURE IS ABSENT. It used to be sent as 0 on the reasoning that a
// reproduction must copy rather than compose. The parameter is accepted, but
// Google's guidance for this model generation is to leave it at its default of
// 1.0 and warns that lower values "may lead to unexpected behaviour, such as
// looping or degraded performance"; the sampling parameters are marked
// deprecated for the family. Nothing documents what temperature does to image
// latents at all, so sending 0 was an unmeasured bet against the guidance.
// Determinism here rests on the prompt and on the guard, not on a knob.
//
// AN EDIT CONTINUES THE CONVERSATION. See `editContents`.

/** An image as the API takes it: base64 with its declared type. */
export interface GenImage {
  data: string
  mimeType: 'image/png' | 'image/jpeg'
}

/** A `contents` array, ready to post. */
export type GenContents = {
  role: 'user' | 'model'
  parts: Record<string, unknown>[]
}[]

const imagePart = (image: GenImage): Record<string, unknown> => ({
  inline_data: { mime_type: image.mimeType, data: image.data },
})

/**
 * A first drawing: the images, then the brief, in one user turn.
 *
 * Also the fallback shape for an edit when no thought signature is available —
 * a row drawn before signatures were kept, or one whose current drawing came
 * from the other provider.
 */
export function drawContents(images: GenImage[], prompt: string): GenContents {
  return [{ role: 'user', parts: [...images.map(imagePart), { text: prompt }] }]
}

/**
 * A corrective edit, as a CONTINUATION of the turn that produced the drawing.
 *
 * This is the documented way to iterate on an image ("chat or multi-turn
 * conversation is the recommended way"), and it is a different task for the
 * model than the flat shape it replaces. Flat, the model is handed two
 * anonymous pictures and asked to produce a third: it re-renders a foreign
 * image, and re-rendering is exactly when a shaded region moves. Continuing,
 * it is amending its own last output, with the reasoning that produced it
 * still attached.
 *
 * That attachment is the `thought_signature` the model returns on the image
 * part. The docs are explicit that a signature received "should be passed back
 * exactly as received when sending the conversation history in the next turn"
 * and that failing to circulate it may make the response fail — so a missing
 * signature is not a detail to paper over, it is the reason the caller falls
 * back to `drawContents`.
 */
export function editContents(input: {
  /** The cleaned cut the drawing was made from: the original user turn. */
  cut: GenImage
  /** The brief that produced the drawing, replayed verbatim. */
  drawPrompt: string
  /** The drawing being amended, as the model's own previous output. */
  drawing: GenImage
  /** Its thought signature, passed back byte for byte. */
  signature: string
  /** What to change, and nothing else. */
  followUp: string
}): GenContents {
  return [
    { role: 'user', parts: [imagePart(input.cut), { text: input.drawPrompt }] },
    {
      role: 'model',
      parts: [{ ...imagePart(input.drawing), thought_signature: input.signature }],
    },
    { role: 'user', parts: [{ text: input.followUp }] },
  ]
}

export interface GenBodyOptions {
  /** "512" | "1K" | "2K" | "4K". Omitted means the API's own default of 1K. */
  imageSize?: string
}

/**
 * The request body around a `contents` array.
 *
 * `responseModalities: ['IMAGE']` asks for an image and no prose, which is
 * documented and is what every caller here wants.
 */
export function geminiBody(
  contents: GenContents,
  options: GenBodyOptions = {},
): Record<string, unknown> {
  const generationConfig: Record<string, unknown> = {
    // No temperature: see the note at the top of this file.
    responseModalities: ['IMAGE'],
  }
  if (options.imageSize) {
    generationConfig.imageConfig = { imageSize: options.imageSize }
  }
  return { contents, generationConfig }
}

/**
 * The same body with the resolution request removed.
 *
 * `imageConfig` "will return an error if set for models that don't support
 * these config options", and the model id is operator configuration that can
 * change to one that does not. A lane whose whole point is that it degrades to
 * the cut must not lose a drawing over an optional field, so a caller that is
 * refused for this reason retries once without it rather than giving up.
 */
export function withoutImageConfig(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const config = { ...(body.generationConfig as Record<string, unknown>) }
  delete config.imageConfig
  return { ...body, generationConfig: config }
}

/** Whether a provider's refusal is about the resolution request. */
export function refusedImageConfig(status: number, body: string): boolean {
  return status === 400 && /image_?config|image_?size/i.test(body)
}

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
import { FIGURE_REPRODUCE_PROMPT } from '@/core/extract/figure-gen-prompt'
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
export async function reproduceFigure(cutPng: Buffer): Promise<GenerationResult> {
  if (!config.GEMINI_API_KEY || !config.GEMINI_IMAGE_MODEL) {
    return { png: null, error: 'no Gemini key or model configured', usage: { input: 0, output: 0 } }
  }
  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(config.GEMINI_IMAGE_MODEL)}:generateContent`

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': config.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { inline_data: { mime_type: 'image/png', data: cutPng.toString('base64') } },
              { text: FIGURE_REPRODUCE_PROMPT },
            ],
          },
        ],
        generationConfig: {
          // Reproduction, not invention: the lowest temperature the API allows.
          temperature: 0,
          responseModalities: ['IMAGE'],
        },
      }),
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
    candidates?: { content?: { parts?: { inlineData?: { data?: string }; inline_data?: { data?: string } }[] } }[]
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
  }
  const parts = json.candidates?.[0]?.content?.parts ?? []
  const image = parts.find((p) => p.inlineData?.data || p.inline_data?.data)
  const base64 = image?.inlineData?.data ?? image?.inline_data?.data
  const usage = {
    input: json.usageMetadata?.promptTokenCount ?? 0,
    output: json.usageMetadata?.candidatesTokenCount ?? 0,
  }
  if (!base64) {
    // A text-only answer is the provider declining to draw, and that is a
    // rejection rather than an error worth retrying differently.
    const said = parts.map((p) => (p as { text?: string }).text ?? '').join(' ').slice(0, 200)
    return { png: null, error: `no image returned${said ? `: ${said}` : ''}`, usage }
  }
  return { png: Buffer.from(base64, 'base64'), usage }
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
      return { png: result.png, diff, labels, attempts: attempt, usage }
    }
    lastRejection = [
      ...diff.reasons,
      ...(labels && !labels.passed
        ? [`yazı itib: ${labels.missing.join(', ')}`]
        : []),
    ].join('; ')
    lastRefused = result.png
  }

  return {
    png: null,
    diff: lastDiff,
    labels: lastLabels,
    attempts: 2,
    rejection: lastRejection,
    rejectedPng: lastRefused ?? undefined,
    usage,
  }
}

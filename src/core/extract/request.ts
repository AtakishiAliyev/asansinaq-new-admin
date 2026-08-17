// Builders that turn op payloads into Gemini generateContent bodies.
// Runtime-agnostic and model-free: the caller (Edge Function or eval harness)
// maps the returned modelKey to a concrete model id from its own environment.
// The OpenAI images/edits call is multipart, not JSON — its prompt lives in
// prompts.ts and the caller assembles the FormData itself.
import {
  COMPARE_FIGURES_PROMPT,
  EXTRACT_SYSTEM,
  EXTRACT_SYSTEM_RASTER,
  PARSE_ANSWER_KEY_PROMPT,
  SUGGEST_CATEGORY_PROMPT,
} from '@/core/extract/prompts'
import { FEWSHOT_FIGURES } from '@/core/extract/fewshot'
import {
  compareFiguresSchema,
  extractResponseSchema,
  parseAnswerKeySchema,
  suggestCategorySchema,
} from '@/core/extract/schemas'

/** Which secret-configured model class the op should run on. */
export type ModelKey = 'extract' | 'figure' | 'verify'

export interface GeminiRequest {
  modelKey: ModelKey
  body: Record<string, unknown>
}

export interface ImageInput {
  /** base64 without the data: prefix */
  image: string
  mime: string
}

// dsl    → rule-lane: strong model emits a declarative FigSpec (fewshots on)
// plain  → text-lane: cheap model, figures allowed but rarely present
// raster → colored-lane: figures come from the image model; do not emit specs
export type FigureMode = 'dsl' | 'plain' | 'raster'

export interface ExtractInput extends ImageInput {
  textLayerHint?: string
  testNo?: number
  expectedNumber?: number
  figureMode: FigureMode
  repairNotes?: string
  /**
   * Second-read independence for scans: with no text-layer hint both reads
   * would be identical temperature-0 calls on the same model — swapping the
   * model class makes agreement mean something again.
   */
  modelSwap?: boolean
}

export function buildExtract(input: ExtractInput): GeminiRequest {
  const system =
    input.figureMode === 'raster' ? EXTRACT_SYSTEM_RASTER : EXTRACT_SYSTEM

  const userText = [
    input.testNo ? `Test: ${input.testNo}` : null,
    input.expectedNumber ? `Gözlənilən sual nömrəsi: ${input.expectedNumber}` : null,
    'MƏTN QATI İPUCU (hərflər dəqiqdir, sıra qarışıq ola bilər, içində ox rəqəmləri ola bilər — quruluş üçün ŞƏKLƏ bax):',
    '---',
    input.textLayerHint || '(boş)',
    '---',
    input.figureMode === 'dsl' ? FEWSHOT_FIGURES : null,
    input.repairNotes ? `\n${input.repairNotes}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  const baseKey: ModelKey = input.figureMode === 'plain' ? 'extract' : 'figure'
  return {
    modelKey: input.modelSwap
      ? baseKey === 'extract'
        ? 'figure'
        : 'extract'
      : baseKey,
    body: {
      systemInstruction: { parts: [{ text: system }] },
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: input.mime, data: input.image } },
            { text: userText },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: extractResponseSchema,
      },
    },
  }
}

export function buildCompareFigures(
  original: ImageInput,
  candidate: ImageInput,
): GeminiRequest {
  return {
    modelKey: 'verify',
    body: {
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: original.mime, data: original.image } },
            { inlineData: { mimeType: candidate.mime, data: candidate.image } },
            { text: COMPARE_FIGURES_PROMPT },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: compareFiguresSchema,
      },
    },
  }
}

export interface SuggestCategoryInput {
  stem: string
  options: string[]
  categories: { id: number; name: string; parentId: number | null }[]
}

export function buildSuggestCategory(input: SuggestCategoryInput): GeminiRequest {
  const tree = input.categories
    .map((c) => {
      const parent = input.categories.find((p) => p.id === c.parentId)
      return `${c.id}: ${parent ? `${parent.name} → ` : ''}${c.name}`
    })
    .join('\n')
  return {
    modelKey: 'verify',
    body: {
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `${SUGGEST_CATEGORY_PROMPT}\n\nSUAL:\n${input.stem}\n\nVARİANTLAR:\n${input.options.join('\n')}\n\nKATEQORİYALAR (id: ad):\n${tree}`,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: suggestCategorySchema,
      },
    },
  }
}

export function buildParseAnswerKey(page: ImageInput): GeminiRequest {
  return {
    modelKey: 'verify',
    body: {
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: page.mime, data: page.image } },
            { text: PARSE_ANSWER_KEY_PROMPT },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: parseAnswerKeySchema,
      },
    },
  }
}

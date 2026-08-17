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
  SOLVE_PROMPT,
  SUGGEST_CATEGORY_PROMPT,
} from '@/core/extract/prompts'
import { FEWSHOT_FIGURES } from '@/core/extract/fewshot'
import {
  compareFiguresSchema,
  extractResponseSchema,
  parseAnswerKeySchema,
  solveSchema,
  suggestCategorySchema,
} from '@/core/extract/schemas'

/** Which secret-configured model class the op should run on. */
export type ModelKey = 'extract' | 'figure' | 'solve' | 'verify'

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

  return {
    modelKey: input.figureMode === 'plain' ? 'extract' : 'figure',
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

export interface SolveInput {
  stem: string
  options: { label: string; tex?: string }[]
  /** the question's figure (and/or image options) rendered as one image */
  figure?: ImageInput
}

export function buildSolve(input: SolveInput): GeminiRequest {
  const optionsText = input.options
    .map((o) => `${o.label}) ${o.tex ?? '(şəkilli variant — şəklə bax)'}`)
    .join('\n')
  const parts: Record<string, unknown>[] = []
  if (input.figure) {
    parts.push({
      inlineData: { mimeType: input.figure.mime, data: input.figure.image },
    })
  }
  parts.push({
    text: `${SOLVE_PROMPT}\n\nSUAL:\n${input.stem}\n\nVARİANTLAR:\n${optionsText}`,
  })
  return {
    modelKey: 'solve',
    body: {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: solveSchema,
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

import type Anthropic from '@anthropic-ai/sdk'
import { DETECT_QUESTIONS_PROMPT, PARSE_ANSWER_KEY_PROMPT } from '@/core/extract/prompts'
import {
  EMIT_ANSWER_KEY_TOOL_NAME,
  EMIT_DETECTION_TOOL_NAME,
  emitAnswerKeySchema,
  emitDetectionSchema,
} from '@/core/extract/tool-schema'

// The two reading ops: where the questions sit on a scanned page, and what a
// printed key page says. Both are one image and one prompt, answered through a
// forced tool so the shape is structural rather than asked for in words — a
// detection call once answered with a Markdown table on every page of a book
// with no text layer, and the parser threw on all of them.
//
// These used to be expressed in a Gemini request dialect and translated at the
// Edge Function's door. The translation was the last trace of that provider in
// the reading path, and the survey script had to translate a second time to
// send the same request from Node. Now there is one shape and it is the one
// the API takes.

export interface PageImage {
  /** base64 without the data: prefix */
  image: string
  mime: string
}

/** Everything but the model, which is the caller's configuration. */
export type ReadingRequest = Omit<Anthropic.MessageCreateParamsNonStreaming, 'model'>

function reading(
  page: PageImage,
  prompt: string,
  tool: { name: string; schema: Record<string, unknown> },
): ReadingRequest {
  return {
    max_tokens: 8192,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: page.mime as 'image/jpeg' | 'image/png',
              data: page.image,
            },
          },
          { type: 'text', text: prompt },
        ],
      },
    ],
    tools: [
      {
        name: tool.name,
        description: 'Nəticəni bu alətlə qaytar.',
        input_schema: tool.schema as unknown as Anthropic.Tool.InputSchema,
      },
    ],
    tool_choice: { type: 'tool', name: tool.name },
  }
}

export function buildDetectQuestionsRequest(page: PageImage): ReadingRequest {
  return reading(page, DETECT_QUESTIONS_PROMPT, {
    name: EMIT_DETECTION_TOOL_NAME,
    schema: emitDetectionSchema,
  })
}

export function buildParseAnswerKeyRequest(page: PageImage): ReadingRequest {
  return reading(page, PARSE_ANSWER_KEY_PROMPT, {
    name: EMIT_ANSWER_KEY_TOOL_NAME,
    schema: emitAnswerKeySchema,
  })
}

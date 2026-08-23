// Extraction as ONE Anthropic call per question.
//
// The Gemini lane spends two to four calls on a question — a hint-free second
// read for verification, the first read, sometimes a repair — and re-uploads
// the same crop for each. Here the crop is sent once and the model answers with
// a forced tool call. Verification stops being a second read of the same image
// and becomes render-and-compare, in its own batch wave.
//
// Everything about this file is arranged around the cache prefix, because the
// prefix is most of the request. Anthropic renders `tools`, then `system`, then
// `messages`, and a cache breakpoint covers everything up to and including the
// block it sits on. So:
//
//   tools           the tool schema — a module constant, never per-question
//   system          the copy-only rules + the figure fewshots   <- breakpoint 1
//   messages[0][0]  the book's category tree                    <- breakpoint 2
//   messages[0][1]  the crop
//   messages[0][2]  this question's hint and numbers
//
// The tree earns its own breakpoint because a batch is drained one book at a
// time: it is stable for the whole run, but it is not stable across books, so
// putting it in `system` would invalidate the rules along with it. Below the
// tree everything is per-question and cannot be cached by anyone.
//
// The tree also sits BEFORE the image, which is the opposite of the usual
// vision advice. That advice is about the blocks the question is asking about;
// the crop still comes immediately before the text that refers to it. Anything
// placed above a breakpoint has to be stable, and the tree is the only stable
// thing left.
//
// Model ids are deliberately absent. This returns a LANE, and the caller maps
// it to whatever `MODEL_TEXT`/`MODEL_FIGURE` say — core has no env, and which
// model serves a lane is a question for an eval, not a constant in a library.
import type Anthropic from '@anthropic-ai/sdk'
import { EXTRACT_SYSTEM } from '@/core/extract/prompts'
import { FEWSHOT_FIGURES } from '@/core/extract/fewshot'
import {
  EMIT_QUESTION_TOOL_NAME,
  emitQuestionSchema,
} from '@/core/extract/tool-schema'

/**
 * Which configured model class runs this request. `text` is the cheap tier for
 * questions the segmenter found no artwork in; `figure` is the stronger one,
 * because a misread diagram is not recoverable downstream the way a misread
 * word is.
 */
export type ModelLane = 'text' | 'figure'

export interface CategoryOption {
  id: number
  name: string
  parentId: number | null
}

export interface AnthropicExtractInput {
  /** base64, with no `data:` prefix */
  image: string
  mime: 'image/png' | 'image/jpeg'
  /**
   * The PDF text layer for this crop. A hint, never the source of truth: the
   * letters are exact but the order can be wrong, so the rules tell the model
   * to read structure from the picture. Absent on scans.
   */
  textLayerHint?: string
  testNo?: number
  expectedNumber?: number
  /** The segmenter's verdict, which decides the lane and nothing else. */
  hasFigure: boolean
  /** The book's tree. Empty means "do not attempt a category". */
  categories?: CategoryOption[]
}

export interface AnthropicRequest {
  lane: ModelLane
  /** `model` is the caller's to fill in — see the note above. */
  params: Omit<Anthropic.MessageCreateParamsNonStreaming, 'model'>
}

// One system prompt for every extraction, figures or not.
//
// The Gemini lane picks between two variants, but the third one (`raster`, for
// figures handed to an image model) has no successor here, and the remaining
// two were already the same text. Keeping the fewshots in for text-only
// questions costs a few hundred tokens the first time and nothing afterwards,
// and buys a prefix that is byte-identical for every question in the run.
const SYSTEM_PROMPT = `${EXTRACT_SYSTEM}\n\n${FEWSHOT_FIGURES}`

// Enough for a dense question with a raw_svg figure (capped at 3000 chars by
// the prompt rules) and five options, with room to spare. Hitting the ceiling
// truncates the tool input mid-JSON, which reads downstream as a malformed
// answer rather than as a limit we set.
const MAX_TOKENS = 8192

// NOT strict.
//
// Strict tool use compiles the schema into a sampling grammar, and that
// compiler caps a schema at 24 optional parameters. Ours has 63, because the
// figure shape is a flat union: one object whose `kind` names the figure and
// whose per-kind fields all sit beside each other as optional siblings. That
// shape is inherited from Gemini's responseSchema, which could not express
// oneOf at all, and it is what `wireFigure` and the extraction fixtures read.
//
// So the two are mutually exclusive by construction, and no amount of pruning
// closes a gap of 63 to 24. A real discriminated union would fix both at once
// and is the right eventual answer; it is a schema change with its own
// before-and-after, not something to fold into a provider migration.
//
// The tool is still forced, so the model always answers through it. What is
// lost is the guarantee that the answer validates — which is what lint has
// always been for.
const TOOL: Anthropic.Tool = {
  name: EMIT_QUESTION_TOOL_NAME,
  description:
    'Return the question exactly as printed in the image: its stem, its five options, any figure as a structured spec, and the category it belongs to. Copy the source; never solve it, correct it, or improve it.',
  input_schema: emitQuestionSchema,
}

function categoryTree(categories: CategoryOption[]): string {
  const lines = categories.map((c) => {
    const parent = categories.find((p) => p.id === c.parentId)
    return `${c.id}: ${parent ? `${parent.name} → ` : ''}${c.name}`
  })
  return `KATEQORİYALAR (id: ad):\n${lines.join('\n')}`
}

function questionText(input: AnthropicExtractInput): string {
  return [
    input.testNo ? `Test: ${input.testNo}` : null,
    input.expectedNumber
      ? `Gözlənilən sual nömrəsi: ${input.expectedNumber}`
      : null,
    'MƏTN QATI İPUCU (hərflər dəqiqdir, sıra qarışıq ola bilər, içində ox rəqəmləri ola bilər — quruluş üçün ŞƏKLƏ bax):',
    '---',
    input.textLayerHint || '(boş)',
    '---',
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
}

export function buildAnthropicExtract(
  input: AnthropicExtractInput,
): AnthropicRequest {
  const content: Anthropic.ContentBlockParam[] = []

  if (input.categories?.length) {
    content.push({
      type: 'text',
      text: categoryTree(input.categories),
      cache_control: { type: 'ephemeral' },
    })
  }

  content.push({
    type: 'image',
    source: { type: 'base64', media_type: input.mime, data: input.image },
  })
  content.push({ type: 'text', text: questionText(input) })

  return {
    lane: input.hasFigure ? 'figure' : 'text',
    params: {
      max_tokens: MAX_TOKENS,
      // `temperature` is deliberately absent.
      //
      // The recreation must copy rather than compose, and temperature 0 used to
      // say so. But sampling parameters are REMOVED on the current models —
      // Sonnet 5 rejects `temperature` outright with "deprecated for this
      // model" — while older ones still accept it. This module resolves a lane,
      // not a model id, so it cannot know which it is talking to; the worker
      // can, and adds it back where the configured model takes it.
      //
      // Determinism now rests on the copy-only rules and the forced tool, not
      // on a knob. Nothing here may add a sampling parameter unconditionally.
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: [TOOL],
      // Forced, and single. Left to itself the model sometimes answers in prose
      // alongside the call, and a second tool_use block would give two readings
      // of one question with nothing to choose between them.
      tool_choice: {
        type: 'tool',
        name: EMIT_QUESTION_TOOL_NAME,
        disable_parallel_tool_use: true,
      },
      messages: [{ role: 'user', content }],
    },
  }
}

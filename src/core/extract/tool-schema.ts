// The extraction wire schema, translated from Gemini's responseSchema dialect
// into a JSON Schema an Anthropic tool will accept.
//
// The two dialects are close but not the same, and the differences are silent
// rather than loud: `nullable: true` is a Gemini/OpenAPI spelling that JSON
// Schema does not have, and strict tool use additionally requires every object
// to close itself with `additionalProperties: false`. A schema that keeps the
// first and omits the second is not rejected in a way that names the problem.
//
// The shape itself is NOT redesigned here. It stays the flat "union by
// convention" object it became for Gemini — one `figures[]` item type with a
// `kind` enum and every per-kind field optional beside it — even though a tool
// schema could express a real discriminated union. Two reasons: the eval
// fixtures and `wireFigure` both read that shape today, and changing the
// schema and the provider in one step would leave no way to tell which one
// moved the accuracy. Revisit once the batch lane has a baseline.
import {
  detectQuestionsSchema,
  extractResponseSchema,
  parseAnswerKeySchema,
} from '@/core/extract/schemas'

/** Structural clone that drops `nullable` and closes every object. */
function toJsonSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toJsonSchema)
  if (node === null || typeof node !== 'object') return node

  const source = node as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    // Gemini's spelling for "may be absent". JSON Schema says that with
    // `required`, and a stray keyword here is not an error the API reports.
    if (key === 'nullable') continue
    out[key] = toJsonSchema(value)
  }

  if (out.type === 'object') {
    out.additionalProperties = false
    // An object with no `required` is legal, but strict mode wants the key
    // present rather than inferred.
    out.required ??= []
  }
  return out
}

// Folded in here rather than into schemas.ts on purpose: schemas.ts is still
// live on the Gemini lane, and adding a field there would change what the
// running pipeline asks for and invalidate its cache, for a lane that does not
// exist yet. These two fields exist only on the Anthropic tool.
//
// Category selection used to be its own call. It is folded into extraction
// because the model has already read the question by the time it could answer,
// and a second call re-sends the crop to learn nothing new.
const CATEGORY_FIELDS: Record<string, unknown> = {
  category_id: {
    type: 'integer',
    description:
      'Id of the best-fitting category, taken ONLY from the KATEQORİYALAR list in the user message. Never invent an id and never guess: if nothing in that list fits the question, omit this field entirely. A wrong category is more expensive to undo than a missing one.',
  },
  category_confidence: {
    type: 'number',
    description:
      'How certain the category choice is, 0 to 1. This is confidence in the CATEGORY, not in the reading of the question and not the question difficulty. Below 0.6 a reviewer decides instead.',
  },
}

export const EMIT_QUESTION_TOOL_NAME = 'emit_question'

/**
 * Built once at module load. The tool list is the first thing in the cached
 * prefix, so it must be byte-identical on every request — a schema assembled
 * per call, or one that varies by book, would invalidate the cache for every
 * question and the caching would silently buy nothing.
 */
export const emitQuestionSchema: {
  type: 'object'
  properties: Record<string, unknown>
  required: string[]
  additionalProperties: false
} = (() => {
  const base = toJsonSchema(extractResponseSchema) as {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
  return {
    type: 'object',
    properties: { ...base.properties, ...CATEGORY_FIELDS },
    required: base.required ?? [],
    additionalProperties: false,
  }
})()

// ---- the two utility ops ----
//
// These were built against Gemini's `responseSchema`, which FORCED the output
// to be JSON of that shape. Nothing survived the translation to Anthropic, so
// the schema was appended to the prompt and JSON was asked for in words.
//
// That asking WORKS in practice — `ops_cache` holds well-formed detections from
// before these tools existed. What it does not do is guarantee anything: the
// shape depends on the model volunteering it, on a prompt that has to keep
// saying so, and on a parser that digs a `{` out of whatever comes back. A
// forced tool makes the shape structural instead, which is what the extraction
// wave has always done, and it is the tool definition the Edge Function's own
// comment said this translation was waiting for.
//
// A correction worth leaving in place, because it was nearly acted on: a
// reproduction of the detection call in Node DID come back as a Markdown table
// five times out of five, and that looked like the cause of pages producing
// nothing. It was not. The reproduction had omitted the very prompt block being
// described here, so it measured a request the system never sends. The real
// defect was a name: the op returns `questions`, and the scan schema required
// `anchors`. See `core/segment/scan.ts`.

export const EMIT_DETECTION_TOOL_NAME = 'emit_detection'

export const emitDetectionSchema = toJsonSchema(detectQuestionsSchema) as Record<string, unknown>

export const EMIT_ANSWER_KEY_TOOL_NAME = 'emit_answer_key'

export const emitAnswerKeySchema = toJsonSchema(parseAnswerKeySchema) as Record<string, unknown>

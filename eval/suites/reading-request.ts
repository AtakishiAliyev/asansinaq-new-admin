import {
  buildDetectQuestionsRequest,
  buildParseAnswerKeyRequest,
} from '@/core/extract/request-reading'
import { DETECT_QUESTIONS_PROMPT, PARSE_ANSWER_KEY_PROMPT } from '@/core/extract/prompts'
import {
  EMIT_ANSWER_KEY_TOOL_NAME,
  EMIT_DETECTION_TOOL_NAME,
} from '@/core/extract/tool-schema'
import { deepEq, eq, ok, suite } from '../harness.ts'

// The two reading ops, as the API takes them. A detection call once answered
// with a Markdown table on every page of a book with no text layer because the
// shape was asked for in words; the tool is what makes it structural.
const PAGE = { image: 'AAAA', mime: 'image/jpeg' }

export const readingRequestSuite = suite('reading-request', {
  'a detection is one image, its prompt, and a forced tool'() {
    const request = buildDetectQuestionsRequest(PAGE)
    const content = request.messages[0]!.content as { type: string; text?: string }[]
    eq(content[0]!.type, 'image', 'the page comes first')
    eq(content[1]!.text, DETECT_QUESTIONS_PROMPT, 'then the prompt')
    deepEq(request.tool_choice, { type: 'tool', name: EMIT_DETECTION_TOOL_NAME }, 'the tool is forced')
    const tool = request.tools?.[0]
    eq(tool && 'name' in tool ? tool.name : undefined, EMIT_DETECTION_TOOL_NAME, 'and it is the detection tool')
  },

  'a key read uses its own prompt and its own tool'() {
    const request = buildParseAnswerKeyRequest(PAGE)
    const content = request.messages[0]!.content as { type: string; text?: string }[]
    eq(content[1]!.text, PARSE_ANSWER_KEY_PROMPT, 'the key prompt')
    deepEq(request.tool_choice, { type: 'tool', name: EMIT_ANSWER_KEY_TOOL_NAME }, 'the key tool')
  },

  'the model is left to the caller'() {
    ok(!('model' in buildDetectQuestionsRequest(PAGE)), 'configuration, not a constant')
  },

  'the image keeps the mime it was given'() {
    const content = buildDetectQuestionsRequest({ image: 'BBBB', mime: 'image/png' })
      .messages[0]!.content as { source?: { media_type: string; data: string } }[]
    eq(content[0]!.source?.media_type, 'image/png', 'mime')
    eq(content[0]!.source?.data, 'BBBB', 'bytes')
  },
})

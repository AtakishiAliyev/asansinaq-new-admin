// The shape of an image request, pinned offline.
//
// None of this can be checked by running the lane: a drawing costs money, and
// the three things below fail SILENTLY when they regress. An imageSize that
// stops being sent gives a blurrier picture at the same price. A temperature
// that creeps back in is accepted by the API and undocumented in its effect. A
// multi-turn edit that loses its thought signature degrades into the flat
// shape that was moving shaded regions, and the only symptom is a figure that
// is subtly wrong.
import {
  drawContents,
  editContents,
  geminiBody,
  refusedImageConfig,
  withoutImageConfig,
  type GenImage,
} from '@/core/figures/gen-request'
import { figureEditFollowUpPrompt, figureEditPrompt } from '@/core/extract/figure-gen-prompt'
import { deepEq, eq, notOk, ok, suite } from '../harness.ts'

const CUT: GenImage = { data: 'AAAA', mimeType: 'image/png' }
const DRAWING: GenImage = { data: 'BBBB', mimeType: 'image/jpeg' }

const partsOf = (contents: ReturnType<typeof drawContents>, i: number) => contents[i]!.parts

export const genRequestSuite = suite('gen-request', {
  'a first drawing is one user turn: images then the brief'() {
    const contents = drawContents([CUT], 'draw this')
    eq(contents.length, 1, 'one turn')
    eq(contents[0]!.role, 'user')
    const parts = partsOf(contents, 0)
    deepEq(parts[0], { inline_data: { mime_type: 'image/png', data: 'AAAA' } }, 'the image first')
    deepEq(parts[1], { text: 'draw this' }, 'then the brief')
  },

  'each image is declared with the type its bytes actually are'() {
    const parts = partsOf(drawContents([CUT, DRAWING], 'x'), 0)
    eq((parts[0] as { inline_data: { mime_type: string } }).inline_data.mime_type, 'image/png')
    eq((parts[1] as { inline_data: { mime_type: string } }).inline_data.mime_type, 'image/jpeg')
  },

  // The documented way to iterate on an image, and a different task for the
  // model: amending its own last output rather than re-rendering a stranger's.
  'an edit continues the conversation that produced the drawing'() {
    const contents = editContents({
      cut: CUT,
      drawPrompt: 'reproduce this',
      drawing: DRAWING,
      signature: 'SIG',
      followUp: 'fix the shading',
    })
    eq(contents.length, 3, 'user, model, user')
    eq(contents[0]!.role, 'user')
    eq(contents[1]!.role, 'model', 'the drawing is the MODEL’s turn, not an attachment')
    eq(contents[2]!.role, 'user')
    deepEq(partsOf(contents, 0)[1], { text: 'reproduce this' }, 'the original brief is replayed')
    deepEq(partsOf(contents, 2)[0], { text: 'fix the shading' }, 'the follow-up stands alone')
  },

  // "Failure to circulate thought signatures may cause the response to fail."
  'the thought signature rides on the drawing part, byte for byte'() {
    const contents = editContents({
      cut: CUT,
      drawPrompt: 'p',
      drawing: DRAWING,
      signature: 'SIG-abc123==',
      followUp: 'f',
    })
    const part = partsOf(contents, 1)[0] as {
      thought_signature?: string
      inline_data?: { data?: string }
    }
    eq(part.thought_signature, 'SIG-abc123==', 'passed back unchanged')
    eq(part.inline_data?.data, 'BBBB', 'on the same part as the image')
  },

  // The cut is the source of truth and must be in the conversation, or the
  // follow-up's "match the original" refers to nothing.
  'the original cut stays in the conversation for an edit'() {
    const contents = editContents({
      cut: CUT,
      drawPrompt: 'p',
      drawing: DRAWING,
      signature: 's',
      followUp: 'f',
    })
    const first = partsOf(contents, 0)[0] as { inline_data?: { data?: string } }
    eq(first.inline_data?.data, 'AAAA', 'the cut is the first user turn')
  },

  // The two briefs are not interchangeable: in the multi-turn shape there is
  // no second attached picture, so naming one would point at nothing.
  'the follow-up brief never refers to a second attached image'() {
    const followUp = figureEditFollowUpPrompt('- figure: shading moved')
    ok(followUp.includes('- figure: shading moved'), 'carries the findings')
    notOk(/IMAGE 2/.test(followUp), 'no IMAGE 2 in a conversation that has none')
    ok(/you just produced/.test(followUp), 'points at the model’s own output')
    ok(/Change ONLY what the reviewer listed/.test(followUp), 'narrow')
    // The flat brief, for the fallback, still names both.
    ok(/IMAGE 2/.test(figureEditPrompt('x')), 'the flat brief still names both images')
  },

  // Unset, the API draws at 1K, the size both model cards call blurry for
  // small text. Exam figures are small labels on thin lines.
  'the resolution is asked for, not left to the default'() {
    const body = geminiBody(drawContents([CUT], 'p'), { imageSize: '2K' })
    const config = body.generationConfig as { imageConfig?: { imageSize?: string } }
    eq(config.imageConfig?.imageSize, '2K')
  },

  'no resolution configured means the field is absent, not empty'() {
    const config = geminiBody(drawContents([CUT], 'p')).generationConfig as Record<string, unknown>
    notOk('imageConfig' in config, 'an empty imageConfig would be a different request')
  },

  // Sent as 0 for a year on the reasoning that a copy must not compose. The
  // guidance for this model family is to leave it alone, and nothing documents
  // what it does to image output at all.
  'no sampling parameter is sent'() {
    const config = geminiBody(drawContents([CUT], 'p'), { imageSize: '2K' })
      .generationConfig as Record<string, unknown>
    notOk('temperature' in config, 'temperature is not ours to set here')
    notOk('topP' in config, 'nor topP')
    notOk('topK' in config, 'nor topK')
    deepEq(config.responseModalities, ['IMAGE'], 'an image and no prose')
  },

  // The model id is operator configuration and can change to one that rejects
  // the field. A lane that degrades to the cut must not lose a drawing to an
  // optional parameter.
  'a refusal about the resolution is recognised and retried without it'() {
    ok(refusedImageConfig(400, 'Invalid JSON payload received. Unknown name "imageConfig"'))
    ok(refusedImageConfig(400, 'image_size is not supported for this model'))
    notOk(refusedImageConfig(400, 'API key not valid'), 'an unrelated 400 is not this')
    notOk(refusedImageConfig(401, 'imageConfig'), 'auth is not a config refusal')

    const body = geminiBody(drawContents([CUT], 'p'), { imageSize: '2K' })
    const retried = withoutImageConfig(body)
    const config = retried.generationConfig as Record<string, unknown>
    notOk('imageConfig' in config, 'the retry drops the field')
    deepEq(config.responseModalities, ['IMAGE'], 'and changes nothing else')
    deepEq(retried.contents, body.contents, 'the conversation is untouched')
    ok('imageConfig' in (body.generationConfig as Record<string, unknown>), 'the original is not mutated')
  },
})

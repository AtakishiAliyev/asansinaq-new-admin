// The instruction for a 1:1 figure reproduction.
//
// In core rather than in the worker because it is an asset, like every other
// prompt: it is versioned, it is the thing that gets tuned, and the eval pins
// it. The operator arrived at this wording by testing it on real figures, so
// the rules below are transcribed intent rather than invention — and the one
// addition is the last line, which names the failure their own sample showed.
// 2 splits the corrective edit in two. The flat brief below still serves the
// fallback path, where the model is handed two anonymous pictures; the
// follow-up brief serves the documented multi-turn path, where the drawing is
// the model's OWN previous output and talking about "IMAGE 2" would point at
// nothing.
export const FIGURE_GEN_PROMPT_VERSION = 2

export const FIGURE_REPRODUCE_PROMPT = `Reproduce this figure EXACTLY as it appears.

This is a reproduction task, NOT a design task. The image you are given is a
figure from a printed exam question. Redraw it faithfully.

MUST:
- Keep every line, curve, arrow, tick, dash and dot that is present.
- Keep every label, letter, number and symbol, with the SAME text, in the SAME
  place. If a label reads "A\\B", reproduce "A\\B" — do not correct it.
- Keep every colour exactly: the same regions shaded in the same colours. In
  these questions the colour IS the answer.
- Keep the same geometry: the same relative positions, sizes, angles and
  proportions. A shaded region must cover the same area of the same shapes.
- Keep the figure's own aspect ratio; place it centred on a white background.

MUST NOT:
- Do not add anything that is not in the original — no extra labels, no legend,
  no title, no axis names, no decoration, no grid.
- Do not remove anything, however minor it looks. A dashed guide line, a small
  dot, an arrowhead and a tick mark are all part of the question.
- Do not "improve", straighten, re-balance, re-letter or re-colour anything.
- Do not answer, solve or annotate the question.
- Do not write any text that is not printed in the original.

Draw lines cleanly and text legibly, but change NOTHING about what is drawn.
Pay particular attention to where lines END: a guide that touches an axis in the
original must touch it in your reproduction.`

/**
 * The instruction for a CORRECTIVE edit.
 *
 * Two images go with it: the original cut, and the reproduction the verifier
 * faulted. The verifier's own words are the brief, and the brief is narrow on
 * purpose — a model told "fix the shading" will happily re-letter the axes
 * while it is at it, and every such improvement is a new difference for the
 * next verdict to find.
 */
export function figureEditPrompt(findings: string): string {
  return `Two images are attached.
IMAGE 1 is the ORIGINAL figure from a printed exam question. It is the source of truth.
IMAGE 2 is our reproduction of IMAGE 1. A reviewer compared them and found that IMAGE 2 differs from IMAGE 1 in these respects:

${findings}

Produce a corrected version of IMAGE 2 that matches IMAGE 1 in exactly those respects.

MUST:
- Fix ONLY what the reviewer listed, by copying how IMAGE 1 has it.
- Keep every other line, label, colour, position and proportion of IMAGE 2 exactly as it is.
- Keep every shaded region exactly where IMAGE 1 shades it, and nothing shaded where IMAGE 1 leaves white.

MUST NOT:
- Do not redraw the figure from scratch, restyle it, re-letter it, or "improve" it.
- Do not add anything not present in IMAGE 1, and do not remove anything IMAGE 1 has.
- Do not write any text that is not printed in IMAGE 1.

Return only the corrected figure on a white background.`
}

/**
 * The corrective brief for the MULTI-TURN path.
 *
 * Here the faulted drawing is the model's own last turn, not an attachment, so
 * there is no "IMAGE 2" to name and no second picture to compare against: the
 * only image in the conversation is the original cut, from the first turn. The
 * instruction is therefore to amend, which is a smaller and better-posed task
 * than to redraw — and the narrowness is repeated, because a model asked to
 * fix the shading will re-letter the axes on the way past if it is not told
 * twice not to.
 */
export function figureEditFollowUpPrompt(findings: string): string {
  return `A reviewer compared the figure you just produced against the original figure (the image in my first message) and found these differences:

${findings}

Amend the figure you just produced so that it matches the original in exactly those respects, by copying how the original has them.

MUST:
- Change ONLY what the reviewer listed.
- Keep every other line, label, colour, position and proportion of your figure byte-for-byte as it already is.
- Keep every shaded region exactly where the original shades it, and leave white everything the original leaves white.

MUST NOT:
- Do not redraw the figure from scratch, restyle it, re-letter it, or "improve" anything the reviewer did not mention.
- Do not add anything absent from the original, and do not remove anything the original has.
- Do not write any text that is not printed in the original.

Return only the corrected figure on a white background.`
}

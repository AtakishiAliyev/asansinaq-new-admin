// The instruction for a 1:1 figure reproduction.
//
// In core rather than in the worker because it is an asset, like every other
// prompt: it is versioned, it is the thing that gets tuned, and the eval pins
// it. The operator arrived at this wording by testing it on real figures, so
// the rules below are transcribed intent rather than invention — and the one
// addition is the last line, which names the failure their own sample showed.
export const FIGURE_GEN_PROMPT_VERSION = 1

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

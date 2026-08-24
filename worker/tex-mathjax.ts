// The real typesetter, injected into the core renderer.
//
// `core` ships a Unicode fallback that is right for the vocabulary figures
// carry — letters, digits, degrees, Greek — and visibly wrong for a fraction.
// That is the correct trade for a module three runtimes import. Verification is
// different: the whole point is to compare our rendering of the question
// against the printed original, and a stem whose fractions have collapsed to
// `a/2` would be reported as a difference from the source when the difference
// is ours.
//
// So the worker injects MathJax, which produces self-contained SVG that resvg
// can rasterise. `fontCache: 'local'` is load bearing: the shared 'global'
// cache puts glyph paths in one `<defs>` outside each fragment, and a fragment
// lifted out of that page renders as empty boxes.
import { mathjax } from 'mathjax-full/js/mathjax.js'
import { TeX } from 'mathjax-full/js/input/tex.js'
import { SVG } from 'mathjax-full/js/output/svg.js'
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js'
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js'
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js'
import type { TexRenderer } from '@/core/figures/svg-emit'

const adaptor = liteAdaptor()
RegisterHTMLHandler(adaptor)

const document = mathjax.document('', {
  InputJax: new TeX({ packages: AllPackages }),
  OutputJax: new SVG({ fontCache: 'local' }),
})

/**
 * MathJax numbers its glyph ids from a counter that advances on every call, so
 * the same formula typeset twice produces different bytes. That is invisible on
 * a page and fatal here: a render-and-compare wave whose renders differ from
 * run to run can never attribute a difference to the question.
 *
 * The counter is replaced with a hash of the formula itself. Identical TeX then
 * yields identical ids — and identical `<defs>`, so a page containing the same
 * formula twice is still correct.
 */
function stabiliseIds(svg: string, tex: string): string {
  let hash = 5381
  for (let i = 0; i < tex.length; i++) hash = ((hash << 5) + hash + tex.charCodeAt(i)) | 0
  const stamp = (hash >>> 0).toString(36)
  return svg.replace(/MJX-\d+-/g, `MJX-${stamp}-`)
}

/**
 * MathJax reports size in `ex`. One ex is the x-height of the font, which for
 * the faces it uses is close to 0.45em — good enough for laying out labels,
 * and deliberately rounded UP so a measurement error leaves a label with too
 * much room rather than too little.
 */
const EX_PER_EM = 0.45

const cache = new Map<string, { svg: string; width: number; height: number }>()

/**
 * Symbols the source writes literally and TeX has no glyph for.
 *
 * Figure labels arrive as the book prints them — `30°`, not `30^\circ` — and
 * MathJax renders an unknown character as a tofu-ish mark, so a correct label
 * came out as `30˜`. That is a difference the verification wave will report,
 * and it would be our difference rather than the extraction's.
 */
function texify(tex: string): string {
  return tex
    .replace(/°/g, '^\\circ ')
    .replace(/′/g, "'")
    .replace(/″/g, "''")
    .replace(/×/g, '\\times ')
    .replace(/÷/g, '\\div ')
    .replace(/≤/g, '\\leq ')
    .replace(/≥/g, '\\geq ')
    .replace(/≠/g, '\\neq ')
    .replace(/∥/g, '\\parallel ')
    .replace(/⊥/g, '\\perp ')
    .replace(/√/g, '\\sqrt ')
    .replace(/π/g, '\\pi ')
    .replace(/∞/g, '\\infty ')
}

export const mathjaxRenderer: TexRenderer = (tex, fontSize) => {
  const key = `${fontSize}::${tex}`
  const hit = cache.get(key)
  if (hit) return hit

  let rendered: { svg: string; width: number; height: number }
  try {
    const node = document.convert(texify(tex), { display: false })
    const raw = adaptor.innerHTML(node)
    const widthEx = Number(/width="([\d.]+)ex"/.exec(raw)?.[1] ?? 0)
    const heightEx = Number(/height="([\d.]+)ex"/.exec(raw)?.[1] ?? 0)
    const width = Math.ceil(widthEx * fontSize * EX_PER_EM) || fontSize
    const height = Math.ceil(heightEx * fontSize * EX_PER_EM) || fontSize

    const svg = stabiliseIds(raw, tex)
      // The style carries a vertical-align in ex, which means nothing once the
      // fragment is positioned by its box. Explicit px width/height replace the
      // ex ones so resvg does not have to resolve a relative unit.
      .replace(/style="[^"]*"/, '')
      .replace(/width="[\d.]+ex"/, `width="${width}"`)
      .replace(/height="[\d.]+ex"/, `height="${height}"`)
    rendered = { svg, width, height }
  } catch {
    // A formula MathJax cannot parse is a defect in the extraction, not a
    // reason to abandon the page: the rest of the question still has to be
    // compared, and the broken TeX shows up as itself.
    const text = tex.replace(/[<>&]/g, '')
    rendered = {
      svg: `<text x="0" y="${Math.round(fontSize * 0.78)}" font-size="${fontSize}" fill="#D33436">${text}</text>`,
      width: Math.ceil(text.length * fontSize * 0.58),
      height: Math.ceil(fontSize * 1.15),
    }
  }

  cache.set(key, rendered)
  return rendered
}

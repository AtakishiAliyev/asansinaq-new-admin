// The small pieces every emitter needs: escaping, attribute serialisation,
// colour lookup, and the fallback typesetter.
//
// Its own module so `render.ts` can dispatch to per-kind emitters and those
// emitters can share this without importing the dispatcher back.
import { COLOR_HEX, type ColorToken } from '@/core/figures/figspec'
import { texToUnicode } from '@/core/figures/tex-unicode'

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
}

export function esc(value: string): string {
  return value.replace(/[&<>"']/g, (c) => XML_ESCAPES[c] ?? c)
}

/** Rounded, so the same figure serialises to the same bytes every time. */
export const num = (n: number): string =>
  Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '0'

export function tag(
  name: string,
  attrs: Record<string, string | number | undefined | null>,
  children?: string,
): string {
  const rendered = Object.entries(attrs)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}="${esc(typeof v === 'number' ? num(v) : String(v))}"`)
    .join(' ')
  const open = rendered ? `${name} ${rendered}` : name
  // The closing tag is the NAME, not the opening tag. Getting this wrong emits
  // `</text x="0" …>`, which a browser forgives and an XML parser does not —
  // so it renders on screen and fails the moment anything tries to rasterise
  // it. It shipped that way once, and the figures looked fine.
  return children === undefined ? `<${open}/>` : `<${open}>${children}</${name}>`
}

export const hex = (
  color: ColorToken | undefined,
  fallback: ColorToken = 'ink',
): string => COLOR_HEX[color ?? fallback]

/**
 * `\overline{ab}` → the text and the fact that it is overlined.
 *
 * The bar is NOT decoration. In these books `ab` with a bar over it is the
 * two-digit number whose digits are a and b, and `ab` without one is the
 * product a·b — different questions, same letters. The command map used to
 * expand `\overline` to the empty string, which turned every one of them into
 * the other silently, in whichever renderer had no better idea.
 *
 * Only a whole-string overline is recognised, which is how these figures use
 * it. A partial one (`\overline{ab}5`) falls through to the caller's normal
 * path rather than being drawn wrong.
 */
export function splitOverline(tex: string): { inner: string; overline: boolean } {
  const m = /^\s*\\(?:overline|bar)\s*\{([^{}]*)\}\s*$/.exec(tex.replace(/\$+/g, ''))
  return m ? { inner: m[1]!, overline: true } : { inner: tex, overline: false }
}

/**
 * TeX in, an SVG fragment and its measured size out.
 *
 * The size is what makes placement possible: a label cannot be kept clear of a
 * stroke without knowing how big it is. A renderer that cannot measure should
 * OVER-estimate — a label with too much room is a cosmetic problem, one with
 * too little is on top of the drawing.
 *
 * The fragment is positioned by the caller and must therefore be drawn at the
 * origin, with its own top-left at (0, 0).
 */
export type TexRenderer = (
  tex: string,
  fontSize: number,
) => { svg: string; width: number; height: number }

/** Rough serif advance width. Over-estimating is the safe direction. */
const AVERAGE_ADVANCE = 0.58
/** Where the baseline sits inside the box, as a fraction of the font size. */
const ASCENT = 0.78

/**
 * The fallback typesetter: one SVG text node, with TeX mapped to Unicode.
 *
 * Correct for the vocabulary figures actually use — letters, digits, degrees,
 * Greek — and honest about the rest. What it will never do is emit a
 * backslash: `\alpha` printed literally is not a degraded label, it is a wrong
 * one, and the reader has no way to tell it was meant to be a variable.
 */
export const plainTextRenderer: TexRenderer = (tex, fontSize) => {
  const { inner, overline } = splitOverline(tex)
  const text = texToUnicode(inner)
  // Counted in code points: a Greek letter is one glyph, and `text.length`
  // would over-count any surrogate pair.
  const width = Math.ceil([...text].length * fontSize * AVERAGE_ADVANCE)
  // An overlined number is dropped down far enough to fit its bar inside the
  // box, so the caller's placement needs no special case.
  const baseline = fontSize * (overline ? ASCENT + OVERLINE_DROP : ASCENT)
  const body = tag(
    'text',
    {
      x: 0,
      y: num(baseline),
      'font-size': fontSize,
      'font-family': 'Georgia, "Times New Roman", serif',
      fill: 'currentColor',
    },
    esc(text),
  )
  return {
    svg: overline ? body + overlineRule(width, fontSize) : body,
    width,
    height: Math.ceil(fontSize * (overline ? 1.15 + OVERLINE_DROP : 1.15)),
  }
}

/** How far an overlined glyph drops to make room for its bar, in em. */
const OVERLINE_DROP = 0.12

/** The bar itself, drawn across the measured width at the top of the box. */
export const overlineRule = (width: number, fontSize: number): string =>
  tag('line', {
    x1: 0,
    y1: num(fontSize * 0.06),
    x2: num(width),
    y2: num(fontSize * 0.06),
    stroke: 'currentColor',
    'stroke-width': num(Math.max(1, fontSize * 0.055)),
  })

// TeX → Unicode, for the case where nothing better is available.
//
// Figure labels are not documents. They are "A", "30°", "α", "2a" — a
// vocabulary small enough that a lookup table covers nearly all of it, and the
// alternative is shipping a typesetting engine into `core`, which would then
// have to load in the browser, in the worker and in the eval.
//
// So this is the FALLBACK. When M6 injects a real renderer that one wins and
// none of this runs. What this guarantees is the floor: a backslash must never
// reach the SVG. `\alpha` printed literally on a diagram is not a degraded
// label, it is a wrong one — the reader sees a word where the question put a
// variable, and no amount of squinting recovers the intent.
//
// Unknown commands therefore lose their backslash rather than keeping it: a
// stray `phi` reads as a name, which is wrong but legible, while `\phi` reads
// as a rendering failure and casts doubt on everything else in the picture.

const SYMBOLS: Record<string, string> = {
  // Greek — the whole point of this table. Angles are named with these.
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε',
  zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ',
  tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',

  // Geometry notation, which is most of what is left.
  circ: '°', degree: '°', angle: '∠', measuredangle: '∡', triangle: '△',
  perp: '⊥', parallel: '∥', nparallel: '∦', cong: '≅', sim: '∼',
  simeq: '≃', equiv: '≡', neq: '≠', ne: '≠', leq: '≤', le: '≤',
  geq: '≥', ge: '≥', approx: '≈', times: '×', cdot: '·', div: '÷',
  pm: '±', mp: '∓', infty: '∞', sqrt: '√', overline: '', bar: '',
  prime: '′', ldots: '…', dots: '…', to: '→', rightarrow: '→',
  leftarrow: '←', leftrightarrow: '↔', cap: '∩', cup: '∪', in: '∈',
  subset: '⊂', subseteq: '⊆', emptyset: '∅', varnothing: '∅',
}

const SUPERSCRIPTS: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', n: 'ⁿ', i: 'ⁱ',
}

const SUBSCRIPTS: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
  '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', a: 'ₐ', n: 'ₙ', x: 'ₓ',
}

/** `^{2}` / `^2` and `_{1}` / `_1`, where every character has a Unicode form. */
function scripts(text: string): string {
  return text.replace(/([_^])\{?([^{}\s]+?)\}?(?=$|[^0-9a-zA-Z]|\s)/g, (all, mark, body: string) => {
    const table = mark === '^' ? SUPERSCRIPTS : SUBSCRIPTS
    const mapped = [...body].map((c) => table[c])
    return mapped.every((c) => c !== undefined) ? mapped.join('') : all
  })
}

/**
 * Best-effort TeX → plain Unicode.
 *
 * Guaranteed post-condition: the result contains no backslash. Everything else
 * is a courtesy.
 */
export function texToUnicode(input: string): string {
  let out = input.trim()

  // Delimiters first — the renderer supplies math mode, so they are noise.
  out = out.replace(/\$+/g, '')

  // `^\circ` and `^{\circ}` are how a degree sign is spelled in TeX, and they
  // must collapse to ° BEFORE the generic superscript pass sees a backslash.
  out = out.replace(/\^\s*\{?\s*\\circ\s*\}?/g, '°')
  out = out.replace(/\\(?:degree|textdegree)\b/g, '°')

  // A fraction has no single-line Unicode form; a slash is the honest reading.
  out = out.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '$1/$2')

  out = out.replace(/\\([a-zA-Z]+)/g, (_all, name: string) => {
    const mapped = SYMBOLS[name]
    // Unknown command: drop the backslash, keep the word. Wrong but legible
    // beats a backslash on the page, which reads as a broken renderer.
    return mapped !== undefined ? mapped : name
  })

  out = scripts(out)

  // Grouping braces have no meaning once the commands are gone.
  out = out.replace(/[{}]/g, '')
  // Any surviving escape — `\\`, `\,`, `\;` — goes with it.
  out = out.replace(/\\/g, '')

  return out.replace(/\s+/g, ' ').trim()
}

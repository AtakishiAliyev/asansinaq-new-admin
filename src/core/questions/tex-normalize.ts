import katex from 'katex'

// Normalize a few things the book relies on that KaTeX otherwise mangles:
//  - Turkish decimal commas (1,62) must not get math-mode spacing → wrap in {,}
//  - bare Turkish label words like Ç.K, S.S inside $...$ should be \text{}
export function normalizeTex(src: string): string {
  return src.replace(/(\d),(\d)/g, '$1{,}$2').replace(/•/g, '\\bullet ')
}

// Validate that a TeX string compiles — used by the lint layer.
// katex.renderToString is DOM-free, so this stays runtime-agnostic.
export function texCompiles(tex: string): boolean {
  try {
    katex.renderToString(normalizeTex(tex), { throwOnError: true, strict: false })
    return true
  } catch {
    return false
  }
}

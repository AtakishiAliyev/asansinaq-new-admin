// Turning model-written SVG into something safe to put on a page.
//
// The escape hatch this serves is worth having — an arbitrary plane-geometry
// diagram fits none of the structured figure kinds, and without it the model
// returns nothing and the question reaches review with its subject missing.
// But the input is markup written by a model from a scanned page, which makes
// it untrusted in the strictest sense: it is neither our text nor the user's.
//
// So nothing here produces a string to inject. The SVG is parsed into a tree,
// every element and attribute is checked against an allowlist, and the caller
// renders that tree as elements. There is no `innerHTML` path at any point,
// which means a payload has no route to execute even if the allowlists below
// were wrong.
//
// Runtime-agnostic on purpose: no DOMParser, so the same check runs in the
// browser, in an Edge Function and in the eval harness.

export interface SvgNode {
  tag: string
  attrs: Record<string, string>
  children: SvgNode[]
  /** text content, for <text>/<tspan> */
  text?: string
}

export interface SvgSanitizeResult {
  node: SvgNode | null
  /** what was thrown away, so review can see the model tried something odd */
  dropped: string[]
}

// Shapes, grouping and labels: everything a diagram of lines and angles needs
// and nothing that loads, scripts or animates. `image` and `use` are absent
// deliberately — both pull in content from elsewhere.
const ELEMENTS = new Set([
  'svg', 'g', 'defs', 'marker', 'title', 'desc',
  'path', 'line', 'polyline', 'polygon', 'rect', 'circle', 'ellipse',
  'text', 'tspan',
])

const ATTRS = new Set([
  'viewBox', 'width', 'height', 'xmlns', 'preserveAspectRatio',
  'd', 'points', 'transform',
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'dx', 'dy',
  'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap',
  'stroke-linejoin', 'stroke-opacity', 'fill-opacity', 'fill-rule', 'opacity',
  'font-size', 'font-family', 'font-weight', 'font-style',
  'text-anchor', 'dominant-baseline', 'letter-spacing',
  'marker-start', 'marker-end', 'marker-mid',
  'id', 'class',
  'refX', 'refY', 'markerWidth', 'markerHeight', 'orient', 'markerUnits',
])

/** Arrowheads are `marker-end="url(#id)"`, and a ray without one is wrong. */
const LOCAL_URL = /^url\(\s*#[A-Za-z][\w:.-]*\s*\)$/
const DANGEROUS_VALUE = /javascript:|data:|expression\s*\(|<|&#/i

function safeAttrValue(value: string): boolean {
  if (value.length > 4096) return false
  if (value.startsWith('url(')) return LOCAL_URL.test(value)
  return !DANGEROUS_VALUE.test(value)
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&')
}

const ATTR_RE = /([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g

function parseAttrs(raw: string, dropped: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of raw.matchAll(ATTR_RE)) {
    const name = m[1]!
    const value = decodeEntities(m[3] ?? m[4] ?? '')
    // Event handlers and anything that resolves a reference are refused by
    // name, before any value check gets a chance to be clever.
    if (/^on/i.test(name) || /href$/i.test(name) || name === 'style') {
      dropped.push(`atribut ${name}`)
      continue
    }
    if (!ATTRS.has(name)) {
      dropped.push(`atribut ${name}`)
      continue
    }
    if (!safeAttrValue(value)) {
      dropped.push(`atribut ${name} (dəyər)`)
      continue
    }
    out[name] = value
  }
  return out
}

/**
 * Parses the SVG subset a diagram needs. Not a general XML parser: anything it
 * does not understand is dropped rather than guessed at, which is the correct
 * bias when the alternative is rendering something unexamined.
 */
export function sanitizeSvg(source: string): SvgSanitizeResult {
  const dropped: string[] = []
  if (typeof source !== 'string' || source.length > 200_000) {
    return { node: null, dropped: ['svg çox böyükdür və ya mətn deyil'] }
  }

  // Comments, doctypes, processing instructions and CDATA carry nothing a
  // figure needs, and each is a place to hide markup from a naive scanner.
  const src = source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '')

  const stack: SvgNode[] = []
  let root: SvgNode | null = null
  /** depth inside an element we refused; everything under it goes too */
  let skipDepth = 0
  const TAG_RE = /<\s*(\/?)\s*([A-Za-z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)\s*>/g

  let last = 0
  for (const m of src.matchAll(TAG_RE)) {
    const [full, closing, rawTag, rawAttrs, selfClose] = m
    const tag = rawTag!.includes(':') ? rawTag!.split(':').pop()! : rawTag!

    // Text between the previous tag and this one belongs to the open element.
    if (!skipDepth && stack.length) {
      const text = decodeEntities(src.slice(last, m.index)).trim()
      if (text) {
        const parent = stack[stack.length - 1]!
        parent.text = (parent.text ?? '') + text
      }
    }
    last = m.index + full.length

    if (closing) {
      if (skipDepth) {
        skipDepth--
        continue
      }
      stack.pop()
      continue
    }

    if (skipDepth) {
      if (!selfClose) skipDepth++
      continue
    }

    if (!ELEMENTS.has(tag)) {
      dropped.push(`element ${tag}`)
      if (!selfClose) skipDepth++
      continue
    }

    const node: SvgNode = {
      tag,
      attrs: parseAttrs(rawAttrs ?? '', dropped),
      children: [],
    }
    if (!root) {
      // A figure must be one <svg>. A stray fragment is not renderable and is
      // not worth guessing a wrapper for.
      if (tag !== 'svg') {
        dropped.push(`kök element ${tag}`)
        if (!selfClose) skipDepth++
        continue
      }
      root = node
    } else {
      stack[stack.length - 1]?.children.push(node)
    }
    if (!selfClose) stack.push(node)
  }

  if (!root) return { node: null, dropped: [...dropped, 'svg tapılmadı'] }
  return { node: root, dropped: [...new Set(dropped)] }
}

/** Rough element count, used to reject an empty or trivial "figure". */
export function svgNodeCount(node: SvgNode): number {
  return 1 + node.children.reduce((n, c) => n + svgNodeCount(c), 0)
}

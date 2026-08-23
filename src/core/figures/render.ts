// FigSpec → SVG, as a string, with no DOM and no React.
//
// Rendering used to live entirely in React components, which meant the only
// way to see a figure was to mount it in a browser. That is why `eval/README`
// said for so long that rendering was uncovered, and why the worker could not
// check its own output: verification needs a picture, and the picture needed a
// tab.
//
// This file only dispatches. The work is split by concern so that four more
// figure kinds can be added without any of them re-solving the same problems:
//
//   svg-emit.ts       escaping, attributes, the fallback typesetter
//   tex-unicode.ts    TeX → Unicode, so no backslash ever reaches the page
//   layout.ts         fitting a cloud to a canvas, collision, label placement
//   render-geometry.ts  the plane-geometry emitter
//
// Two things are deliberately NOT solved here. Typesetting is delegated to an
// injected renderer — core has no business bundling a TeX engine, and the two
// runtimes want different ones — the same way `core/segment/crop.ts` injects a
// canvas factory. And layout ACROSS items is the caller's: this returns one
// `<svg>` per item, and the review screen stacks them while the worker
// composes them onto a page.
import type { FigItem, FigureDoc } from '@/core/figures/figspec'
import { toMarkup } from '@/core/figures/svg-safe'
import { layoutGeometry } from '@/core/figures/render-geometry'
import { esc, hex, num, plainTextRenderer, tag, type TexRenderer } from '@/core/figures/svg-emit'

export { esc, num, tag, plainTextRenderer, type TexRenderer }
export { layoutGeometry } from '@/core/figures/render-geometry'
export { texToUnicode } from '@/core/figures/tex-unicode'
export { CLEARANCE } from '@/core/figures/layout'

export interface RenderOptions {
  tex?: TexRenderer
  /**
   * Prefix for any generated id.
   *
   * Ids must be deterministic: the same figure has to render to the same bytes
   * on the worker and in the browser, or a render-and-compare wave would see a
   * difference in every figure and learn nothing from any of them. The old venn
   * renderer used a module-level counter that never reset, so the same document
   * rendered differently depending on what had been rendered before it.
   */
  idPrefix?: string
}

/** One `<svg>` per item, in document order. */
export function renderFigureDoc(doc: FigureDoc, options: RenderOptions = {}): string[] {
  return doc.items.map((item, index) =>
    renderFigItem(item, { ...options, idPrefix: `${options.idPrefix ?? 'fig'}-${index}` }),
  )
}

export function renderFigItem(item: FigItem, options: RenderOptions = {}): string {
  switch (item.kind) {
    case 'geometry':
      return layoutGeometry(item, options.tex ?? plainTextRenderer).svg
    case 'raw_svg':
      // Already sanitized at the extraction boundary; this only re-serialises
      // the tree we chose to keep.
      return toMarkup(item.node)
    default:
      // Not ported yet. Returning an empty string would look like a figure that
      // rendered to nothing, which is exactly the failure this lane exists to
      // catch — so it says so instead.
      return unsupported(item.kind)
  }
}

function unsupported(kind: string): string {
  return tag(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      viewBox: '0 0 260 40',
      width: 260,
      height: 40,
    },
    tag(
      'text',
      { x: 8, y: 24, 'font-size': 12, 'font-family': 'monospace', fill: hex('muted') },
      esc(`${kind}: not renderable outside the browser yet`),
    ),
  )
}

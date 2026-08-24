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
import { renderCubes } from '@/core/figures/render-cubes'
import { renderVenn } from '@/core/figures/render-venn'
import { renderFunctionGraph } from '@/core/figures/render-graph'
import {
  renderDivisionScheme,
  renderNumberLine,
  renderTable,
  renderVerticalArithmetic,
} from '@/core/figures/render-simple'
import { esc, hex, num, plainTextRenderer, tag, type TexRenderer } from '@/core/figures/svg-emit'

export { esc, num, tag, plainTextRenderer, type TexRenderer }
export { geometryFit, layoutGeometry } from '@/core/figures/render-geometry'
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
  const tex = options.tex ?? plainTextRenderer
  switch (item.kind) {
    case 'geometry':
      return layoutGeometry(item, tex).svg
    case 'venn':
      // The id prefix is the figure's position in the document, never a
      // counter: masks are referenced by id, and a counter that never resets
      // makes the same diagram serialise differently depending on what was
      // rendered before it.
      return renderVenn(item, tex, options.idPrefix ?? 'venn')
    case 'function_graph':
      return renderFunctionGraph(item, tex)
    case 'table':
      return renderTable(item, tex)
    case 'division_scheme':
      return renderDivisionScheme(item, tex)
    case 'vertical_arithmetic':
      return renderVerticalArithmetic(item, tex)
    case 'number_line':
      return renderNumberLine(item, tex)
    case 'cubes':
      return renderCubes(item, tex)
    case 'image': {
      // A region cut out of the original crop, for a figure no vector kind can
      // express. Drawn at the natural size of the cut when we know it: forcing
      // a fixed box would stretch it, and a stretched copy of the source is a
      // difference the verification wave would report against the source it
      // was cut from.
      const w = item.w && item.w > 0 ? item.w : 420
      const h = item.h && item.h > 0 ? item.h : 300
      return tag(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          viewBox: `0 0 ${num(w)} ${num(h)}`,
          width: w,
          height: h,
        },
        // Both dimensions, always: given one, a rasteriser draws the image at
        // its intrinsic size and silently ignores the dimension that was set.
        tag('image', { href: item.src, x: 0, y: 0, width: w, height: h }),
      )
    }
    case 'raw_svg':
      // Already sanitized at the extraction boundary; this only re-serialises
      // the tree we chose to keep.
      return toMarkup(item.node)
    default:
      // Every kind in the union is handled above, so this is unreachable —
      // until someone adds a kind and forgets. Returning an empty string would
      // look like a figure that rendered to nothing, which is exactly the
      // failure this lane exists to catch, so it says so instead.
      return unsupported((item as { kind: string }).kind)
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

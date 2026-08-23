import type { GeometryFig } from '@/core/figures/figspec'
import { renderFigItem } from '@/core/figures/render'

// A wrapper, not a renderer.
//
// The drawing is done by `core/figures/render.ts`, so the review screen and the
// worker's verification wave produce the same SVG from the same spec. A second
// implementation here would mean a reviewer approving one picture while the
// verifier compared another — the two would have to disagree before anyone
// noticed, and by then the disagreement is in the bank.
//
// `dangerouslySetInnerHTML` is safe here for the same reason it is safe for
// `raw_svg`: the markup is built by us from a typed spec, and every value goes
// through the escaper in `render.ts`. Nothing model-authored reaches it as
// markup — `raw_svg` is the only kind that carries model markup at all, and it
// is sanitized into a tree at the extraction boundary long before this.
export function GeometryFigView({ fig }: { fig: GeometryFig }) {
  return (
    <div
      className="text-foreground [&_svg]:h-auto [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: renderFigItem(fig) }}
    />
  )
}

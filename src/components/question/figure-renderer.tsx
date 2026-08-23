import type { FigItem, FigureDoc } from '@/core/figures/figspec'
import { renderFigItem } from '@/core/figures/render'

// A wrapper, not a renderer.
//
// Every figure kind is drawn by `core/figures/render.ts`, so the review screen
// and the worker's verification wave produce the same SVG from the same spec.
// A second implementation here would mean a reviewer approving one picture
// while the verifier compared another, and the two would have to disagree
// before anyone noticed — by which point the disagreement is in the bank.
//
// `dangerouslySetInnerHTML` is safe because the markup is built by us from a
// typed spec and every value goes through the escaper in `svg-emit.ts`. The one
// kind that carries model-authored markup, `raw_svg`, is sanitized into a
// typed tree at the extraction boundary and re-serialised from that tree —
// there is no path from a raw model string to this element.
export function FigItemView({
  item,
  resolveImageUrl,
  index = 0,
}: {
  item: FigItem
  /** Maps an image fig's `src` (storage path) to a displayable URL. */
  resolveImageUrl?: (src: string) => string
  /** Position in the document — the seed for deterministic element ids. */
  index?: number
}) {
  const resolved =
    item.kind === 'image' && resolveImageUrl
      ? { ...item, src: resolveImageUrl(item.src) }
      : item
  return (
    <div
      className="text-foreground [&_svg]:h-auto [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{
        __html: renderFigItem(resolved, { idPrefix: `fig-${index}` }),
      }}
    />
  )
}

export function FigureRenderer({
  doc,
  resolveImageUrl,
}: {
  doc: FigureDoc
  resolveImageUrl?: (src: string) => string
}) {
  return (
    <div
      className="flex flex-wrap items-start gap-4"
      style={doc.layout?.direction === 'column' ? { flexDirection: 'column' } : undefined}
    >
      {doc.items.map((item, index) => (
        <FigItemView
          key={index}
          item={item}
          index={index}
          resolveImageUrl={resolveImageUrl}
        />
      ))}
    </div>
  )
}

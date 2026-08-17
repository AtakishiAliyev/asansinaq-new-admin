import type { FigItem, FigureDoc } from '@/core/figures/figspec'
import { FunctionGraphView } from './function-graph'
import { VennFigView } from './venn-fig'
import { DivisionSchemeView, NumberLineView, TableFigView, VerticalArithmeticView } from './simple-figs'

const identity = (src: string) => src

export function FigItemView({
  item,
  resolveImageUrl = identity,
}: {
  item: FigItem
  // Maps an image fig's `src` (storage path or data URL) to a displayable URL.
  resolveImageUrl?: (src: string) => string
}) {
  switch (item.kind) {
    case 'function_graph':
      return <FunctionGraphView fig={item} />
    case 'venn':
      return <VennFigView fig={item} />
    case 'division_scheme':
      return <DivisionSchemeView fig={item} />
    case 'vertical_arithmetic':
      return <VerticalArithmeticView fig={item} />
    case 'table':
      return <TableFigView fig={item} />
    case 'number_line':
      return <NumberLineView fig={item} />
    case 'image':
      return (
        <img
          src={resolveImageUrl(item.src)}
          alt="AI ilə yenidən çəkilmiş fiqur"
          title="AI ilə çəkilmiş raster fiqur — orijinalla vizual müqayisə tələb olunur"
          className="block w-full max-w-[420px]"
        />
      )
    default:
      return <div style={{ color: '#c0392b' }}>Naməlum fiqur növü</div>
  }
}

export function FigureRenderer({
  doc,
  resolveImageUrl,
}: {
  doc: FigureDoc
  resolveImageUrl?: (src: string) => string
}) {
  const dir = doc.layout?.direction ?? 'row'
  const gap = doc.layout?.gap ?? 16
  return (
    <div className="flex flex-wrap items-start" style={{ flexDirection: dir, gap }}>
      {doc.items.map((it, i) => (
        <FigItemView key={i} item={it} resolveImageUrl={resolveImageUrl} />
      ))}
    </div>
  )
}

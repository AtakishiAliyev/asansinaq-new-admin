import { COLOR_HEX, type FigureDoc } from '@/core/figures/figspec'
import { FigureRenderer } from './figure-renderer'
import { StemText, Tex } from './tex'

export interface QuestionPreviewOption {
  label: string
  tex?: string
  image?: string // storage path or data URL; resolved via resolveImageUrl
}

export interface QuestionPreviewData {
  stem: string
  options: QuestionPreviewOption[]
  figures?: FigureDoc | null
}

// The recreated, watermark-free question — rendered with the SAME components the
// end product uses, so "looks right here" == "renders right in production".
export function QuestionPreview({
  question,
  resolveImageUrl,
}: {
  question: QuestionPreviewData
  // Maps image srcs (question figures and image options) to displayable URLs.
  resolveImageUrl?: (src: string) => string
}) {
  const resolve = resolveImageUrl ?? ((src: string) => src)
  return (
    <div className="space-y-3">
      {question.figures && (
        <div className="py-1">
          <FigureRenderer doc={question.figures} resolveImageUrl={resolveImageUrl} />
        </div>
      )}
      <div className="text-[15px] leading-relaxed">
        <StemText text={question.stem} />
      </div>
      <div className="grid grid-cols-1 gap-1 text-[15px] sm:grid-cols-2">
        {question.options.map((o, i) => (
          <div key={`${o.label}-${i}`} className="flex gap-2">
            <span className="font-semibold" style={{ color: COLOR_HEX.secondary }}>
              {o.label})
            </span>
            {o.tex !== undefined && <Tex tex={o.tex} />}
            {o.image !== undefined && (
              <img src={resolve(o.image)} alt={`${o.label} variantı`} className="block max-h-40 max-w-full" />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

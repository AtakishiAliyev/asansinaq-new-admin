import type { FigureDoc } from '@/core/figures/figspec'
import { cn } from '@/lib/utils'
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

// THE canonical question layout — every surface that shows a question uses
// this component, so a question looks the same in review, in the bank, and
// later in the student app. Reading order follows the printed book: the
// figure plate, then the premise and the question line, then the options.
//
// The surface is deliberately quiet. This is the book's content, not our
// interface: no accent colours, no branding, nothing competing with the
// question itself. Identity lives in the chrome around it.

/** A short option is one that can sit beside four others on one line. */
const SHORT_OPTION_CHARS = 14
const MEDIUM_OPTION_CHARS = 34

type OptionLayout = 'row' | 'grid' | 'stack' | 'gallery'

// Printed books set options on one line when they are short (A) 12 B) 14 …),
// in two columns when they are medium, and stacked when each needs a line.
// Deriving the layout from the content keeps that rhythm instead of forcing
// one grid that breaks long options and wastes space on short ones.
function optionLayout(options: QuestionPreviewOption[]): OptionLayout {
  // Picture options are printed side by side, not down the page — five
  // stacked figures would turn one question into a scroll.
  if (options.some((o) => o.image)) return 'gallery'
  const longest = Math.max(0, ...options.map((o) => (o.tex ?? '').length))
  if (longest <= SHORT_OPTION_CHARS) return 'row'
  if (longest <= MEDIUM_OPTION_CHARS) return 'grid'
  return 'stack'
}

const LAYOUT_CLASS: Record<OptionLayout, string> = {
  row: 'flex flex-wrap items-baseline gap-x-6 gap-y-2',
  grid: 'grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2',
  stack: 'flex flex-col gap-2.5',
  gallery: 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5',
}

function OptionMark({
  label,
  isAnswer,
}: {
  label: string
  isAnswer: boolean
}) {
  return (
    <span
      aria-hidden
      className={cn(
        // Fixed width so option contents align in a column no matter the letter.
        'inline-flex size-5 shrink-0 items-center justify-center rounded-full font-mono text-[11px] leading-none',
        isAnswer
          ? 'bg-emerald-600 font-semibold text-white'
          : 'text-muted-foreground border',
      )}
    >
      {label}
    </span>
  )
}

export function QuestionPreview({
  question,
  answer,
  density = 'default',
  resolveImageUrl,
}: {
  question: QuestionPreviewData
  /** Marks the correct option when it is known (approved questions, review). */
  answer?: string | null
  /** compact trims the figure and type for list rows and side-by-side panes. */
  density?: 'default' | 'compact'
  // Maps image srcs (question figures and image options) to displayable URLs.
  resolveImageUrl?: (src: string) => string
}) {
  const resolve = resolveImageUrl ?? ((src: string) => src)
  const layout = optionLayout(question.options)
  const compact = density === 'compact'

  return (
    <article
      className={cn(
        'text-foreground',
        compact ? 'space-y-2.5 text-sm' : 'space-y-4 text-[15px]',
      )}
    >
      {question.figures?.items.length ? (
        // One plate for every figure kind: a vector DSL render and a generated
        // raster sit in the same frame at the same scale, so questions do not
        // jump in size depending on which lane produced them.
        <figure
          className={cn(
            'flex justify-center overflow-hidden rounded-md border bg-white p-3',
            compact ? '[&_svg]:max-h-40 [&_img]:max-h-40' : '[&_svg]:max-h-80 [&_img]:max-h-80',
            '[&_img]:w-auto [&_img]:object-contain [&_svg]:w-auto',
          )}
        >
          <FigureRenderer doc={question.figures} resolveImageUrl={resolveImageUrl} />
        </figure>
      ) : null}

      {/* Premise lines and the question line, exactly as printed: the stem
          carries its own newlines, so leading does the separating. A diagram
          question has none — the wording was printed above its group — and an
          empty block would put a gap where nothing was. */}
      {question.stem.trim() ? (
        <div className={compact ? 'leading-relaxed' : 'leading-[1.75]'}>
          <StemText text={question.stem} />
        </div>
      ) : null}

      <ul className={cn(LAYOUT_CLASS[layout], 'list-none')}>
        {question.options.map((o, i) => {
          const isAnswer = Boolean(answer && o.label === answer)
          return (
            <li
              key={`${o.label}-${i}`}
              className={cn(
                layout === 'gallery'
                  ? 'flex flex-col items-center gap-1.5'
                  : 'flex items-start gap-2',
                isAnswer && 'font-medium',
              )}
            >
              <OptionMark label={o.label} isAnswer={isAnswer} />
              <span className="sr-only">{o.label} variantı</span>
              {o.tex !== undefined ? (
                <Tex tex={o.tex} className="min-w-0" />
              ) : null}
              {o.image !== undefined ? (
                <img
                  src={resolve(o.image)}
                  alt=""
                  className={cn(
                    'block w-full rounded border bg-white object-contain p-1',
                    compact ? 'max-h-24' : 'max-h-40',
                    isAnswer && 'ring-2 ring-emerald-600',
                  )}
                />
              ) : null}
            </li>
          )
        })}
      </ul>
    </article>
  )
}

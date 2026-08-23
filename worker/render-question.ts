// A question, rendered back into a picture.
//
// This is the half of verification the model cannot do for us. Asking "does
// this JSON match that crop?" makes the model hold a structured object and an
// image in its head at once and report on both; asking "do these two pictures
// show the same question?" is a comparison it is actually good at. So the row
// is drawn — stem, figure, options — and the two images go side by side.
//
// It does not try to look like the book. Same content, same order, same
// figures; different font, different spacing, no watermark. The compare prompt
// is written for that, and a renderer chasing typographic fidelity would be
// spending effort to make the one difference that matters harder to see.
import { Resvg } from '@resvg/resvg-js'
import type { ExtractedOption, ExtractedQuestion } from '@/core/questions/extraction'
import { renderFigItem } from '@/core/figures/render'
import { esc, num, tag } from '@/core/figures/svg-emit'
import { mathjaxRenderer } from './tex-mathjax.ts'
import type { Db } from './db.ts'

const WIDTH = 620
const PAD = 18
const STEM_SIZE = 16
const OPTION_SIZE = 15
const LINE_GAP = 7
const BLOCK_GAP = 14

interface Piece {
  svg: string
  width: number
  height: number
  /** A space may be broken here; a math island may not be split. */
  breakable: boolean
}

/** Prose words and `$…$` islands, each measured. */
function pieces(text: string, fontSize: number): Piece[] {
  const out: Piece[] = []
  for (const part of text.split(/(\$[^$]*\$)/g)) {
    if (part === '') continue
    if (part.startsWith('$') && part.endsWith('$') && part.length > 2) {
      const fragment = mathjaxRenderer(part.slice(1, -1), fontSize)
      out.push({ ...fragment, breakable: false })
      continue
    }
    // Prose is drawn as text rather than typeset: MathJax would set it in a
    // maths font and italicise every word.
    for (const word of part.split(/(\s+)/)) {
      if (word === '') continue
      out.push({
        svg: tag(
          'text',
          {
            x: 0,
            y: Math.round(fontSize * 0.8),
            'font-size': fontSize,
            'font-family': 'DejaVu Sans, Arial, sans-serif',
            fill: '#1A1A1A',
          },
          esc(word),
        ),
        width: Math.ceil([...word].length * fontSize * 0.5),
        height: Math.ceil(fontSize * 1.2),
        breakable: /^\s+$/.test(word),
      })
    }
  }
  return out
}

/**
 * One paragraph, wrapped to a width.
 *
 * Wrapping is not cosmetic here. Without it a long stem line runs off the
 * canvas and the rasteriser simply clips it — and the verification wave, doing
 * its job, reports the missing words as a difference from the original. The
 * first live run of the corrupted-fixture test flagged an untouched question
 * for exactly that: the recreation was missing "kaçtır?" because the renderer
 * had run out of paper, not because the extraction had lost it.
 */
function paragraph(
  text: string,
  fontSize: number,
  maxWidth: number,
): { svg: string; height: number } {
  const lineHeight = Math.ceil(fontSize * 1.35)
  const rows: Piece[][] = [[]]
  let x = 0
  for (const piece of pieces(text, fontSize)) {
    const current = rows[rows.length - 1]!
    if (x + piece.width > maxWidth && current.length) {
      // A break consumes the space that caused it, so the next line does not
      // start indented.
      if (piece.breakable) {
        rows.push([])
        x = 0
        continue
      }
      rows.push([piece])
      x = piece.width
      continue
    }
    current.push(piece)
    x += piece.width
  }

  const body: string[] = []
  let y = 0
  for (const row of rows) {
    if (!row.length) continue
    const tallest = Math.max(...row.map((p) => p.height), lineHeight)
    let cursor = 0
    for (const piece of row) {
      body.push(
        tag(
          'g',
          { transform: `translate(${num(cursor)} ${num(y + (tallest - piece.height) / 2)})` },
          piece.svg,
        ),
      )
      cursor += piece.width
    }
    y += tallest
  }
  return { svg: body.join(''), height: Math.max(y, lineHeight) }
}

/** A single unwrapped run, for short things like an option label. */
function inlineLine(text: string, fontSize: number): { svg: string; width: number; height: number } {
  const laid = pieces(text, fontSize)
  let x = 0
  const body: string[] = []
  let height = Math.ceil(fontSize * 1.2)
  for (const piece of laid) {
    body.push(tag('g', { transform: `translate(${num(x)} 0)` }, piece.svg))
    x += piece.width
    height = Math.max(height, piece.height)
  }
  return { svg: body.join(''), width: Math.ceil(x), height }
}

interface Block {
  svg: string
  height: number
}

function optionBlock(
  option: ExtractedOption,
  images: Map<string, string>,
): Block {
  const label = inlineLine(`${option.label})`, OPTION_SIZE)
  const parts: string[] = [tag('g', { transform: 'translate(0 0)' }, label.svg)]
  let height = label.height

  const embedded = option.image ? images.get(option.image) : undefined
  if (embedded) {
    // The cut option image, inlined. It is the source's own pixels, so it is
    // the one part of the render that should look exactly like the crop.
    const h = 64
    parts.push(
      tag('image', { href: embedded, x: 34, y: 0, height: h, preserveAspectRatio: 'xMinYMin meet' }),
    )
    height = Math.max(height, h)
  } else if (option.tex) {
    const body = paragraph(`$${option.tex}$`, OPTION_SIZE, WIDTH - PAD * 2 - 34)
    parts.push(tag('g', { transform: `translate(34 0)` }, body.svg))
    height = Math.max(height, body.height)
  } else {
    // Neither text nor picture. Drawn as an explicit gap rather than omitted,
    // because a missing option and a blank one are different defects and the
    // comparison has to be able to tell them apart.
    parts.push(
      tag(
        'text',
        { x: 34, y: Math.round(OPTION_SIZE * 0.8), 'font-size': OPTION_SIZE, fill: '#D33436' },
        '[boş]',
      ),
    )
  }
  return { svg: parts.join(''), height }
}

/** Pull an `<svg …>` fragment out of its wrapper so it can be nested. */
function inner(svg: string): { body: string; width: number; height: number } {
  const width = Number(/\bwidth="([\d.]+)"/.exec(svg)?.[1] ?? 0)
  const height = Number(/\bheight="([\d.]+)"/.exec(svg)?.[1] ?? 0)
  return { body: svg, width, height }
}

export interface RenderedQuestion {
  svg: string
  png: Buffer
  width: number
  height: number
}

/**
 * Draw the question as one page.
 *
 * Option images are passed in already base64'd: this is pure composition, and
 * fetching is the caller's so a render can be produced without a database.
 */
export function renderQuestion(
  question: ExtractedQuestion,
  optionImages: Map<string, string> = new Map(),
): RenderedQuestion {
  const blocks: Block[] = []

  for (const line of question.stem.split('\n')) {
    if (!line.trim()) continue
    const rendered = paragraph(line, STEM_SIZE, WIDTH - PAD * 2)
    blocks.push({ svg: rendered.svg, height: rendered.height })
  }

  for (const [index, item] of (question.figures?.items ?? []).entries()) {
    const figure = inner(renderFigItem(item, { idPrefix: `v-${index}`, tex: mathjaxRenderer }))
    blocks.push({ svg: figure.body, height: figure.height || 120 })
  }

  for (const option of question.options) {
    blocks.push(optionBlock(option, optionImages))
  }

  let y = PAD
  const body: string[] = []
  for (const [index, block] of blocks.entries()) {
    body.push(tag('g', { transform: `translate(${PAD} ${num(y)})` }, block.svg))
    // Figures and the option list get more air than consecutive stem lines,
    // so the reader can see where one part of the question ends.
    const previous = blocks[index - 1]
    y += block.height + (previous && previous.height > 40 ? BLOCK_GAP : LINE_GAP)
  }
  const height = Math.ceil(y + PAD)

  const svg = tag(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      'xmlns:xlink': 'http://www.w3.org/1999/xlink',
      viewBox: `0 0 ${WIDTH} ${height}`,
      width: WIDTH,
      height,
    },
    tag('rect', { x: 0, y: 0, width: WIDTH, height, fill: '#ffffff' }) + body.join(''),
  )

  const png = new Resvg(svg, {
    background: 'white',
    fitTo: { mode: 'width', value: WIDTH * 2 },
    font: { loadSystemFonts: true },
  })
    .render()
    .asPng()

  return { svg, png: Buffer.from(png), width: WIDTH, height }
}

/** The option images a question needs, as data URIs, fetched once. */
export async function fetchOptionImages(
  db: Db,
  question: ExtractedQuestion,
): Promise<Map<string, string>> {
  const images = new Map<string, string>()
  for (const option of question.options) {
    const path = option.image
    if (!path || images.has(path) || path.startsWith('data:')) continue
    const { data } = await db.storage.from('question-crops').download(path)
    if (!data) continue
    const b64 = Buffer.from(await data.arrayBuffer()).toString('base64')
    images.set(path, `data:image/png;base64,${b64}`)
  }
  return images
}

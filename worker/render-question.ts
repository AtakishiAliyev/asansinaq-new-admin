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
import { sniffImageMime } from '@/core/figures/image-mime'
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
  /** Prose only. Adjacent prose on one line is drawn as a single `<text>`, so
   *  the renderer's own metrics decide the spacing instead of our estimate. */
  text?: string
}

const textRun = (text: string, fontSize: number): string =>
  tag(
    'text',
    {
      x: 0,
      y: Math.round(fontSize * 0.8),
      'font-size': fontSize,
      'font-family': 'DejaVu Sans, Arial, sans-serif',
      fill: '#1A1A1A',
      // Without this the renderer collapses the leading space of a run, and
      // every line after a math island starts flush against it.
      'xml:space': 'preserve',
    },
    esc(text),
  )

/**
 * Roughly how wide a string is, with no font metrics to hand.
 *
 * A flat 0.5em per character was close enough to wrap on and badly wrong to
 * POSITION on: capitals, digits and parentheses are far wider than that, so a
 * word starting after `m(AOC)` began before the previous one had finished and
 * the render read `m(AOC)neçə`. The verification wave then reported the stem as
 * different from the original — correctly, since it was — and the defect was
 * ours rather than the extraction's.
 *
 * Positioning no longer depends on this (adjacent prose is drawn as one run and
 * spaced by the renderer), so it only has to be good enough to choose wrap
 * points.
 */
function measure(text: string, fontSize: number): number {
  let ems = 0
  for (const ch of text) {
    if (ch === ' ') ems += 0.28
    else if (/[iljItf.,;:'`|!]/.test(ch)) ems += 0.3
    else if (/[A-ZĞÜŞİÖÇ0-9()[\]{}@%&]/.test(ch)) ems += 0.62
    else if (/[mwMW]/.test(ch)) ems += 0.85
    else ems += 0.5
  }
  return Math.ceil(ems * fontSize)
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
        svg: textRun(word, fontSize),
        width: measure(word, fontSize),
        height: Math.ceil(fontSize * 1.2),
        breakable: /^\s+$/.test(word),
        text: word,
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
    // Consecutive prose is emitted as ONE <text>, so the renderer's own metrics
    // set the spacing between words. Drawing each word at an estimated offset
    // is what made words collide.
    for (const piece of coalesce(row, fontSize)) {
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

/** Merge neighbouring prose pieces into one drawn run. */
function coalesce(row: Piece[], fontSize: number): Piece[] {
  const out: Piece[] = []
  for (const piece of row) {
    const previous = out[out.length - 1]
    if (piece.text !== undefined && previous?.text !== undefined) {
      const text = previous.text + piece.text
      out[out.length - 1] = {
        ...previous,
        text,
        svg: textRun(text, fontSize),
        width: measure(text, fontSize),
        height: Math.max(previous.height, piece.height),
      }
      continue
    }
    out.push(piece)
  }
  // A trailing space at the end of a line would push the next island right.
  const last = out[out.length - 1]
  if (last?.text !== undefined && /\s$/.test(last.text)) {
    const text = last.text.replace(/\s+$/, '')
    out[out.length - 1] = { ...last, text, svg: textRun(text, fontSize), width: measure(text, fontSize) }
  }
  return out
}

/** A single unwrapped run, for short things like an option label. */
function inlineLine(text: string, fontSize: number): { svg: string; width: number; height: number } {
  const laid = coalesce(pieces(text, fontSize), fontSize)
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

/** How tall a picture option is drawn. Enough to read a pictogram at a glance,
 *  small enough that five of them still fit beside the stem. */
const OPTION_IMAGE_H = 64

/**
 * Width and height straight out of a PNG's IHDR.
 *
 * Needed because an `<image>` given only one dimension is drawn at its natural
 * size rather than scaled, and the aspect ratio is the only way to turn the one
 * dimension we choose into the other. Reading 8 bytes of header is cheaper than
 * decoding the image, and these are our own crops, so the format is known.
 */
function pngSize(dataUri: string): { width: number; height: number } | null {
  const comma = dataUri.indexOf(',')
  if (comma < 0) return null
  const header = Buffer.from(dataUri.slice(comma + 1, comma + 65), 'base64')
  // 8-byte signature, then a 25-byte IHDR chunk whose width and height sit at
  // offsets 16 and 20.
  if (header.length < 24 || header.readUInt32BE(0) !== 0x89504e47) return null
  const width = header.readUInt32BE(16)
  const height = header.readUInt32BE(20)
  return width > 0 && height > 0 ? { width, height } : null
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
    //
    // BOTH dimensions are written out. Given only a height the rasteriser draws
    // the image at its INTRINSIC size and ignores the height entirely — so a
    // 140x174 option crop was painted 174px tall into a block that had reserved
    // 64, and each option overdrew the one below it. What survived was a sliver,
    // which is exactly what the verification wave reported for every picture
    // option on all three IQ questions: "only a small fragment is shown".
    const intrinsic = pngSize(embedded)
    const h = OPTION_IMAGE_H
    const w = intrinsic ? Math.max(1, Math.round((intrinsic.width / intrinsic.height) * h)) : h
    parts.push(
      tag('image', {
        href: embedded,
        x: 34,
        y: 0,
        width: w,
        height: h,
        preserveAspectRatio: 'xMinYMin meet',
      }),
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

/**
 * A figure, scaled down if it is wider than the page.
 *
 * Nesting an SVG inside another does NOT scale it: the inner drawing keeps its
 * own coordinates and whatever runs past the page edge is simply not painted.
 * Six isometric cubes came to 768px on a 620px page, so the sixth — the one
 * carrying the A/B/C faces the question asks about — was cut off entirely, and
 * the verification wave correctly reported a five-cube figure that cannot be
 * solved. Nothing in the figure itself was wrong.
 */
function fitBlock(figure: { body: string; width: number; height: number }, available: number): Block {
  const height = figure.height || 120
  if (!figure.width || figure.width <= available) return { svg: figure.body, height }
  const k = available / figure.width
  return {
    svg: tag('g', { transform: `scale(${num(k)})` }, figure.body),
    height: Math.ceil(height * k),
  }
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

  const available = WIDTH - PAD * 2
  const figures = question.figures?.items ?? []
  // Twin division schemes are printed SIDE BY SIDE, and the question asks about
  // both at once ("bölme işlemlerine göre, L kaçtır?"). Stacked, they read as
  // two separate questions, and the verification wave has to compare that
  // against a page that shows a pair.
  const sideBySide =
    question.figures?.layout?.direction === 'row' ||
    (figures.length === 2 && figures.every((f) => f.kind === 'division_scheme'))
  if (sideBySide) {
    const rendered = figures.map((item, index) =>
      inner(renderFigItem(item, { idPrefix: `v-${index}`, tex: mathjaxRenderer })),
    )
    const gap = 28
    const totalW = rendered.reduce((sum, f) => sum + (f.width || 120), 0) + gap * (rendered.length - 1)
    const scale = totalW > available ? available / totalW : 1
    const height = Math.max(...rendered.map((f) => f.height || 120))
    let x = 0
    const row: string[] = []
    for (const fig of rendered) {
      row.push(tag('g', { transform: `translate(${num(x)} 0)` }, fig.body))
      x += (fig.width || 120) + gap
    }
    const svg = scale < 1 ? tag('g', { transform: `scale(${num(scale)})` }, row.join('')) : row.join('')
    blocks.push({ svg, height: Math.ceil(height * scale) })
  }
  for (const [index, item] of (sideBySide ? [] : figures).entries()) {
    // An `image` figure carries a STORAGE PATH, and a rasteriser cannot fetch
    // one. Left unresolved the figure renders as nothing at all, which is
    // exactly what the verification wave reported for both IQ questions that
    // used the kind: "the main figure is completely absent".
    const resolved =
      item.kind === 'image'
        ? {
            ...item,
            src: item.src.startsWith('data:') ? item.src : (optionImages.get(item.src) ?? item.src),
            ...(item.genSrc && !item.genSrc.startsWith('data:')
              ? { genSrc: optionImages.get(item.genSrc) ?? item.genSrc }
              : {}),
          }
        : item
    const figure = inner(renderFigItem(resolved, { idPrefix: `v-${index}`, tex: mathjaxRenderer }))
    blocks.push(fitBlock(figure, available))
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
      // MathJax emits its glyphs as `fill="currentColor"`, which resolves from
      // the HOST's CSS `color` — so the same SVG is black text in one page and
      // invisible white-on-white in another. Pinning it here makes the document
      // self-contained, which is what both the rasteriser and a reviewer
      // opening it in a dark-themed page need.
      color: '#1A1A1A',
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

/**
 * Every stored image a question needs, as data URIs, fetched once.
 *
 * Both the picture options AND any `image` figure. Figures were the omission:
 * they were cut and stored correctly and then never fetched back, so the page
 * referred to a path a rasteriser has no way to resolve and drew nothing where
 * the figure should have been.
 */
export async function fetchOptionImages(
  db: Db,
  question: ExtractedQuestion,
): Promise<Map<string, string>> {
  const images = new Map<string, string>()
  const paths = [
    ...question.options.map((o) => o.image),
    ...(question.figures?.items ?? []).flatMap((i) =>
      i.kind === 'image' ? [i.src, i.genSrc] : [],
    ),
  ]
  for (const path of paths) {
    if (!path || images.has(path) || path.startsWith('data:')) continue
    const { data } = await db.storage.from('question-crops').download(path)
    if (!data) continue
    const bytes = Buffer.from(await data.arrayBuffer())
    // The declared type has to match the bytes, because the rasteriser believes
    // it. A `.gen.png` written by the image provider is JPEG, and labelling it
    // PNG made resvg decode nothing and paint nothing — a figure the row
    // actually had, absent from the picture the verifier judges.
    const mime = sniffImageMime(bytes)
    if (!mime) continue
    images.set(path, `data:${mime};base64,${bytes.toString('base64')}`)
  }
  return images
}

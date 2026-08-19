import {
  chooseFigureLane,
  fixLeakedNewlines,
  stripDollars,
  wireToQuestion,
} from '@/core/questions/extraction'
import { deepEq, eq, ok, suite } from '../harness.ts'

export const extractionSuite = suite('extraction', {
  'a stray dollar inside an option is stripped'() {
    eq(stripDollars('$x+1$'), 'x+1', 'tək dollar cütü')
    eq(stripDollars('x+1'), 'x+1', 'dollarsız mətn dəyişmir')
  },

  'a leaked newline splits the math block, not the command'() {
    // The model writes "\n" inside $...$; each condition must become its own
    // line, but \neq must survive intact — splitting it produces broken TeX.
    const out = fixLeakedNewlines('$a>0\\nb<0$')
    ok(out.includes('$a>0$'), `birinci şərt ayrıldı: ${out}`)
    ok(out.includes('$b<0$'), `ikinci şərt ayrıldı: ${out}`)

    const neq = fixLeakedNewlines('$a\\neq b$')
    eq(neq, '$a\\neq b$', '\\neq bütöv qalır')
  },

  'the wire shape becomes a question'() {
    const q = wireToQuestion({
      number_seen: 12,
      stem: 'Sual mətni',
      options: [
        { label: 'A', tex: '1' },
        { label: 'B', tex: '2' },
      ],
      confidence: 0.9,
      illegible: false,
    })
    eq(q.numberSeen, 12, 'nömrə')
    eq(q.options.length, 2, 'variant sayı')
    eq(q.figures, null, 'fiqur yoxdur')
  },

  'an image option is marked as a picture'() {
    const q = wireToQuestion({
      stem: 'S',
      options: [{ label: 'A', is_image: true, box: [0, 0, 100, 100] }],
    })
    eq(q.options[0]!.isImage, true, 'isImage')
  },

  'venn items the model split apart are merged back'() {
    // A single Venn drawing emitted as one item per shape would render as
    // several unrelated diagrams.
    const q = wireToQuestion({
      stem: 'S',
      figures: [
        { kind: 'venn', shapes: [{ id: 'A', shape: 'circle', cx: 40, cy: 50, r: 30 }] },
        { kind: 'venn', shapes: [{ id: 'B', shape: 'circle', cx: 70, cy: 50, r: 30 }] },
      ],
    })
    eq(q.figures?.items.length, 1, 'bir fiqur qalır')
    eq(q.figures?.items[0]!.kind, 'venn', 'növ')
  },

  'a missing stem never becomes the string "undefined"'() {
    const q = wireToQuestion({})
    eq(q.stem, '', 'boş mətn')
    deepEq(q.options, [], 'variant yoxdur')
  },

  // The regression this exists for: a plane-geometry question classified
  // `dsl` whose diagram the vector vocabulary cannot express. The model
  // returns no spec, only a box — and the lane used to stay `dsl`, render
  // nothing, and send a question about a picture to review without one.
  'a vector lane with no spec falls back to redrawing the box'() {
    eq(
      chooseFigureLane({
        figureMode: 'dsl',
        hasDslFigures: false,
        hasFigureBox: true,
      }),
      'raster',
    )
  },

  'a spec the model returned is rendered rather than redrawn'() {
    eq(
      chooseFigureLane({
        figureMode: 'dsl',
        hasDslFigures: true,
        hasFigureBox: true,
      }),
      'dsl',
    )
  },

  'a black-and-white drawing the classifier missed is still drawn'() {
    eq(
      chooseFigureLane({
        figureMode: 'plain',
        hasDslFigures: false,
        hasFigureBox: true,
      }),
      'raster',
    )
  },

  'colour outranks the model: the vector vocabulary has none'() {
    eq(
      chooseFigureLane({
        figureMode: 'raster',
        hasDslFigures: true,
        hasFigureBox: true,
      }),
      'raster',
    )
  },

  'no spec and no box means there is nothing to draw'() {
    eq(
      chooseFigureLane({
        figureMode: 'dsl',
        hasDslFigures: false,
        hasFigureBox: false,
      }),
      'plain',
    )
  },
})

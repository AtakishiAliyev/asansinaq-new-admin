import { canonMath } from '@/core/questions/compare'
import { texCompiles } from '@/core/questions/tex-normalize'
import { pointsLieOnCurves, sampleCurve } from '@/core/figures/curve'
import { parseSetExpr, setIdsUsed } from '@/core/figures/set-expr'
import type { ExtractedQuestion } from '@/core/questions/extraction'
import type { FigureDoc } from '@/core/figures/figspec'

export interface Flag {
  level: 'error' | 'warning'
  code: string
  message: string
}

// A stem that talks about a drawing. Three groups, because the books mix them:
// the Turkish printing ("şekil", "yukarıdaki"), the Azerbaijani spelling of the
// same words ("şəkil", "cədvəl"), and plane-geometry vocabulary — a geometry
// stem names the shape instead of saying "figure" ("ABC üçbucağında"), which is
// exactly the class the pixel classifier also misses, since those drawings
// carry no colour and no long horizontal rule.
const REFERENCES_DRAWING = new RegExp(
  [
    // names the drawing outright
    'şema|şəma|şekil|şəkil|grafik|grafiğ|qrafik|venn|tablo|cədvəl|diaqram|sxem',
    // points at it
    'yukarıdaki|yuxarıdakı|yandaki|yandakı|aşağıdaki\\s+(çarpma|bölme|toplama)',
    // names a shape that is only ever drawn. Deliberately excludes kare /
    // kvadrat / kub / açı / çevrə: those are arithmetic words too ("x-in
    // kvadratı", "açıqlayın"), and this flag is an error that costs a
    // reviewer every time it fires.
    // q → ğ before a vowel suffix: "üçbucaq" is "üçbucağında" once declined,
    // which is how a stem actually reads.
    'üçgen|üçbucaq|üçbucağ|dikdörtgen|düzbucaq|paralelkenar|paraleloqram|trapez',
    'prizma|piramit|piramida|silindir|çember|koordinat\\s+müstəvi',
    'sayı\\s+doğrusu|ədəd\\s+oxu',
  ].join('|'),
  'i',
)

// Deterministic checks run on every extraction before it reaches review. Any
// error routes the draft to needs_review; warnings just annotate it.
/** Real options are short: a number, a set, an interval. */
const MAX_OPTION_TEX = 120

export function lintQuestion(q: ExtractedQuestion, expectedNumber?: number): Flag[] {
  const flags: Flag[] = []
  const add = (level: Flag['level'], code: string, message: string) => flags.push({ level, code, message })

  if (q.illegible) add('error', 'illegible', 'Model sualı tam oxuya bilmədi')
  if (q.clipped) add('warning', 'clipped', 'Kəsilmiş məzmun ola bilər (crop kənarı)')
  if (q.foreign) add('warning', 'foreign', 'Qonşu sualın parçası görünür')

  if (q.options.length !== 5) add('error', 'option_count', `Variant sayı ${q.options.length}, 5 olmalıdır`)
  const labels = q.options.map((o) => o.label).join('')
  if (q.options.length === 5 && labels !== 'ABCDE') add('warning', 'option_labels', `Variant hərfləri: ${labels}`)

  // A figure question with no printed stem is a real format, not a failure:
  // these books print the instruction once above a group ("aşağıdaki
  // şekillerde taralı bölge…") and each numbered item is then just a diagram
  // and five options. The crop holds the item, not the heading. Treated as an
  // error it threw away work that was already paid for; the honest reading is
  // that the question is legible and its wording lives outside the crop.
  if (!q.stem.trim()) {
    if (q.figures?.items.length) {
      add(
        'warning',
        'stem_from_figure',
        'Sual mətni yoxdur — şərt şəkildən oxunur, çap olunmuş şərt crop-dan kənardadır',
      )
    } else {
      add('error', 'empty_stem', 'Sual mətni boşdur')
    }
  }
  if (/saveh|oca/i.test(q.stem)) add('error', 'watermark_leak', 'Mətndə watermark izi (saveh/oca)')

  // math compiles
  extractTex(q.stem).forEach((t) => {
    if (!texCompiles(t)) add('error', 'stem_latex', `Stem-də LaTeX xətası: ${t.slice(0, 40)}`)
  })
  q.options.forEach((o) => {
    // `isImage` used to satisfy this check on its own, which made it possible
    // for an option to be declared a picture, never have one generated, and
    // still pass as complete. The flag is the model's intent; only `image` is
    // the thing a student would see.
    if (!o.tex && !o.image) {
      add(
        'error',
        'option_empty',
        o.isImage
          ? `${o.label} variantı şəkil kimi işarələnib, amma şəkli yaradılmayıb`
          : `${o.label} variantı boşdur — nə TeX, nə şəkil var`,
      )
    }
    if (o.tex && !texCompiles(o.tex)) add('error', 'option_latex', `${o.label} variantında LaTeX xətası`)
    // An option is a value, not a sentence. When the model narrates — quoting
    // our own rules back at us, explaining what it decided to omit — the text
    // compiles as LaTeX and every other check passes it.
    if (o.tex && o.tex.length > MAX_OPTION_TEX)
      add(
        'error',
        'option_prose',
        `${o.label} variantı mətn deyil, izahat kimi görünür (${o.tex.length} simvol)`,
      )
  })

  // A well-formed multiple choice never repeats an answer: two identical
  // options mean at least one was misread, and the question is unanswerable
  // as transcribed. Compared canonically, so "\dfrac12" and "\frac{1}{2}"
  // count as the repeat they are.
  const byContent = new Map<string, string[]>()
  q.options.forEach((o) => {
    if (!o.tex) return
    const key = canonMath(o.tex)
    if (!key) return
    byContent.set(key, [...(byContent.get(key) ?? []), o.label])
  })
  for (const [, labels] of byContent) {
    if (labels.length > 1) {
      add(
        'error',
        'option_duplicate',
        `${labels.join(' və ')} variantları eynidir — biri səhv oxunub`,
      )
    }
  }

  if (expectedNumber !== undefined && q.numberSeen && q.numberSeen !== expectedNumber)
    add('warning', 'number_mismatch', `Nömrə ${q.numberSeen}, gözlənilən ${expectedNumber}`)

  if (typeof q.confidence === 'number' && q.confidence < 0.85)
    add('warning', 'low_confidence', `Aşağı əminlik: ${q.confidence}`)

  // Stem references a drawing but the model returned no figure — almost always
  // an extraction failure, never auto-approvable.
  if (!q.figures && REFERENCES_DRAWING.test(q.stem))
    add('error', 'missing_figure', 'Stem şəkilə istinad edir, amma fiqur çıxarılmayıb')

  if (q.figures) flags.push(...lintFigures(q.figures))

  return flags
}

function lintFigures(doc: FigureDoc): Flag[] {
  const flags: Flag[] = []
  for (const item of doc.items) {
    if (item.kind === 'image')
      flags.push({
        level: 'warning',
        code: 'raster_figure',
        message: 'Fiqur AI image-gen ilə rasterdə çəkilib — orijinalla diqqətli vizual müqayisə şərtdir',
      })
    if (item.kind === 'function_graph') {
      for (const p of item.panels) {
        const sampled = p.curves.map((c) => sampleCurve(c.def))
        sampled.forEach((s, i) => {
          if (!s.ok) flags.push({ level: 'error', code: 'curve_invalid', message: `Əyri "${p.curves[i]!.id}" render olunmur: ${s.error ?? ''}` })
        })
        const marks = (p.points ?? []).map((pt) => [pt.x, pt.y] as [number, number])
        if (marks.length) {
          const on = pointsLieOnCurves(marks, sampled)
          on.forEach((ok, i) => {
            if (!ok) flags.push({ level: 'warning', code: 'point_off_curve', message: `İşarəli nöqtə (${marks[i]![0]}, ${marks[i]![1]}) heç bir əyri üzərində deyil` })
          })
        }
      }
    }
    if (item.kind === 'geometry') {
      // A degenerate angle is a real model failure, not a style choice: the
      // arms and the vertex have to be three DIFFERENT points or there is no
      // angle to draw and the mark lands on nothing.
      for (const angle of item.angles ?? []) {
        const [a, v, b] = angle.at
        if (a === v || b === v || a === b) {
          flags.push({
            level: 'error',
            code: 'geo_degenerate_angle',
            message: `Bucaq [${angle.at.join(', ')}] eyni nöqtələrdən ibarətdir — təpə ORTADA və üç nöqtə fərqli olmalıdır`,
          })
        }
        // Both notations for the same fact. A reader looking for the square
        // will not accept an arc, and one of the two is always wrong.
        if (angle.right && angle.arcs) {
          flags.push({
            level: 'warning',
            code: 'geo_right_angle_with_arcs',
            message: `Bucaq [${angle.at.join(', ')}] həm düz bucaq, həm qövslə işarələnib — biri artıqdır`,
          })
        }
      }
      // Equal-length ticks need a finite length to be equal to. On a ray or a
      // line they cannot mean what they say, and the figure they appear in is
      // almost always two parallel rays cut by a transversal — the mark meant
      // was `parallel`. Flagged rather than rewritten: converting it would be
      // the pipeline inventing a given condition, which is the one thing the
      // recreation must never do.
      for (const line of item.lines) {
        if (line.ticks && (line.kind ?? 'segment') !== 'segment') {
          flags.push({
            level: 'warning',
            code: 'geo_ticks_on_ray',
            message: `"${line.from}${line.to}" şüa/xəttdir, amma bərabər uzunluq işarəsi daşıyır — yəqin ki, paralellik (parallel) nəzərdə tutulub`,
          })
        }
      }

      // Two points at the same place is how a misread construction shows up:
      // the lines through them collapse and the figure quietly loses a side.
      const seen = new Map<string, string>()
      for (const point of item.points) {
        const at = `${Math.round(point.x)},${Math.round(point.y)}`
        const other = seen.get(at)
        if (other) {
          flags.push({
            level: 'warning',
            code: 'geo_coincident_points',
            message: `"${other}" və "${point.id}" eyni yerdədir (${at}) — biri səhv oxunub`,
          })
        } else seen.set(at, point.id)
      }
      if (!item.lines.length && !(item.angles ?? []).length) {
        flags.push({
          level: 'error',
          code: 'geo_empty',
          message: 'Həndəsə fiqurunda nə xətt, nə bucaq var — çəkiləcək bir şey yoxdur',
        })
      }
    }

    if (item.kind === 'raw_svg') {
      // The one figure kind nothing can check for us: no schema, no geometry
      // to re-derive, only markup a model wrote. It is worth having, and it is
      // never worth trusting unseen.
      flags.push({
        level: 'warning',
        code: 'raw_svg',
        message: item.dropped?.length
          ? `sərbəst SVG fiquru — insan yoxlaması şərtdir (təmizlənən: ${item.dropped.join(', ')})`
          : 'sərbəst SVG fiquru — insan yoxlaması şərtdir',
      })
    }
    if (item.kind === 'venn') {
      const ids = new Set(item.shapes.map((s) => s.id))
      const exprs = [
        ...item.shaded.map((e) => ({ e, src: 'ştrixləmə' })),
        ...(item.regionLabels ?? []).map((r) => ({ e: r.expr, src: 'bölgə etiketi' })),
      ]
      for (const { e: expr, src } of exprs) {
        try {
          const ast = parseSetExpr(expr)
          for (const used of setIdsUsed(ast)) {
            if (!ids.has(used)) flags.push({ level: 'error', code: 'venn_unknown_set', message: `"${expr}" ifadəsində təyin olunmamış çoxluq: ${used}` })
          }
        } catch (err) {
          flags.push({ level: 'error', code: 'venn_parse', message: `${src} ifadəsi xətası "${expr}": ${(err as Error).message}` })
        }
      }
      if (!item.shapes.length) flags.push({ level: 'error', code: 'venn_empty', message: 'Venn fiqurunda heç bir çoxluq forması yoxdur' })
    }
  }
  return flags
}

function extractTex(text: string): string[] {
  const out: string[] = []
  const re = /\$\$([\s\S]+?)\$\$|\$([^$]+?)\$/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) out.push(m[1] ?? m[2]!)
  return out
}

export function worstLevel(flags: Flag[]): 'error' | 'warning' | 'clean' {
  if (flags.some((f) => f.level === 'error')) return 'error'
  if (flags.some((f) => f.level === 'warning')) return 'warning'
  return 'clean'
}

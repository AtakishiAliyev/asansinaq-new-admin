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

// Deterministic checks run on every extraction before it reaches review. Any
// error routes the draft to needs_review; warnings just annotate it.
export function lintQuestion(q: ExtractedQuestion, expectedNumber?: number): Flag[] {
  const flags: Flag[] = []
  const add = (level: Flag['level'], code: string, message: string) => flags.push({ level, code, message })

  if (q.illegible) add('error', 'illegible', 'Model sualı tam oxuya bilmədi')
  if (q.clipped) add('warning', 'clipped', 'Kəsilmiş məzmun ola bilər (crop kənarı)')
  if (q.foreign) add('warning', 'foreign', 'Qonşu sualın parçası görünür')

  if (q.options.length !== 5) add('error', 'option_count', `Variant sayı ${q.options.length}, 5 olmalıdır`)
  const labels = q.options.map((o) => o.label).join('')
  if (q.options.length === 5 && labels !== 'ABCDE') add('warning', 'option_labels', `Variant hərfləri: ${labels}`)

  if (!q.stem.trim()) add('error', 'empty_stem', 'Sual mətni boşdur')
  if (/saveh|oca/i.test(q.stem)) add('error', 'watermark_leak', 'Mətndə watermark izi (saveh/oca)')

  // math compiles
  extractTex(q.stem).forEach((t) => {
    if (!texCompiles(t)) add('error', 'stem_latex', `Stem-də LaTeX xətası: ${t.slice(0, 40)}`)
  })
  q.options.forEach((o) => {
    if (!o.tex && !o.image && !o.isImage)
      add('error', 'option_empty', `${o.label} variantı boşdur — nə TeX, nə şəkil var`)
    if (o.tex && !texCompiles(o.tex)) add('error', 'option_latex', `${o.label} variantında LaTeX xətası`)
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
  if (!q.figures && /şema|şekil|grafik|grafiğ|yukarıdaki|yandaki|venn|tablo|aşağıdaki\s+(çarpma|bölme|toplama)/i.test(q.stem))
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
          if (!s.ok) flags.push({ level: 'error', code: 'curve_invalid', message: `Əyri "${p.curves[i].id}" render olunmur: ${s.error ?? ''}` })
        })
        const marks = (p.points ?? []).map((pt) => [pt.x, pt.y] as [number, number])
        if (marks.length) {
          const on = pointsLieOnCurves(marks, sampled)
          on.forEach((ok, i) => {
            if (!ok) flags.push({ level: 'warning', code: 'point_off_curve', message: `İşarəli nöqtə (${marks[i][0]}, ${marks[i][1]}) heç bir əyri üzərində deyil` })
          })
        }
      }
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
  while ((m = re.exec(text)) !== null) out.push(m[1] ?? m[2])
  return out
}

export function worstLevel(flags: Flag[]): 'error' | 'warning' | 'clean' {
  if (flags.some((f) => f.level === 'error')) return 'error'
  if (flags.some((f) => f.level === 'warning')) return 'warning'
  return 'clean'
}

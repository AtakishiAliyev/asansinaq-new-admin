// The agent's hands.
//
// Nothing here is new capability — cropping, sanitising SVG, rendering a
// figure and linting a question are all things the pipeline already does at
// fixed points. What changes is who decides the order. The pipeline looks at a
// crop once, at one size, and commits; these let the model look again, look
// closer, choose between cutting a region and drawing it, and check its own
// work before it says it is finished.

import { lintQuestion, type Flag } from '@/core/questions/lint'
import { opRedrawFigure } from '@/features/questions/api/question-ops'
import { sanitizeSvg, svgNodeCount, type SvgNode } from '@/core/figures/svg-safe'
import { snapshotSvgNode } from '@/components/question/snapshot'
import {
  cropRegion,
  fitForModel,
  inkFraction,
  splitDataUrl,
} from '@/features/questions/lib/image'
import type { ExtractedQuestion } from '@/core/questions/extraction'

/** [ymin, xmin, ymax, xmax], 0–1000, the convention every box in this app uses. */
export type Box = [number, number, number, number]

export interface Artefact {
  name: string
  /** data URL — uploaded to storage only if the question is saved */
  dataUrl: string
  source: 'cut' | 'drawn' | 'generated'
  /** where it came from in the crop, for review */
  box?: Box
  /** why a cut was unavoidable — required, because it rarely is */
  reason?: string
  svg?: SvgNode
}

export interface AgentContext {
  /** the original crop, as a data URL */
  cropDataUrl: string
  expectedNumber: number
  artefacts: Map<string, Artefact>
  /** appended as the run goes, for the operator to read afterwards */
  trace: { tool: string; summary: string }[]
}

const asBox = (v: unknown): Box | null => {
  if (!Array.isArray(v) || v.length < 4) return null
  const b = v.slice(0, 4).map(Number)
  return b.every((n) => Number.isFinite(n)) ? (b as Box) : null
}

type ImageBlock = {
  type: 'image'
  source: { type: 'base64'; media_type: string; data: string }
}

async function imageBlock(dataUrl: string): Promise<ImageBlock> {
  const { image, mime } = splitDataUrl(await fitForModel(dataUrl))
  return { type: 'image', source: { type: 'base64', media_type: mime, data: image } }
}

export const AGENT_TOOLS = [
  {
    name: 'look',
    description:
      'Look at the crop, or at one region of it enlarged. Use this whenever something is too small to read or place confidently — a row of option drawings, a label inside a figure, a subscript. Returns an image.',
    input_schema: {
      type: 'object' as const,
      properties: {
        box: {
          type: 'array',
          items: { type: 'number' },
          description: '[ymin,xmin,ymax,xmax] 0-1000 normalized. Omit to see the whole crop.',
        },
        why: { type: 'string', description: 'what you are trying to see' },
      },
      required: ['why'],
    },
  },
  {
    name: 'cut',
    description:
      'LAST RESORT. Keeps a region of the original page as the picture, watermark and all, which is why it is nearly always the wrong answer — the bank outlives these books and a saved crop carries their mark forever. Use it only after `draw` and `generate` have both failed on this region, and say which failed and how. Prefer losing a picture to saving a watermarked one.',
    input_schema: {
      type: 'object' as const,
      properties: {
        box: { type: 'array', items: { type: 'number' }, description: '[ymin,xmin,ymax,xmax] 0-1000' },
        name: { type: 'string', description: 'what this is, e.g. "option_A" or "figure"' },
        reason: {
          type: 'string',
          description: 'what you tried with draw and generate, and how each failed',
        },
      },
      required: ['box', 'name', 'reason'],
    },
  },
  {
    name: 'draw',
    description:
      'Draw a figure as SVG. Returns your drawing rendered as an image, next to the region it should match, so you can judge it yourself and correct the SVG if it is wrong. Prefer this over cutting when the region carries a watermark or content that does not belong to the figure.',
    input_schema: {
      type: 'object' as const,
      properties: {
        svg: { type: 'string', description: 'complete <svg> with a viewBox' },
        name: { type: 'string' },
        against: {
          type: 'array',
          items: { type: 'number' },
          description: '[ymin,xmin,ymax,xmax] of the region this drawing must match',
        },
      },
      required: ['svg', 'name', 'against'],
    },
  },
  {
    name: 'generate',
    description:
      'Redraw a region with the image model. Use this for content a vector drawing cannot express — a shaded illustration, a rendered object, a photograph-like picture — especially when a watermark crosses it so cutting is not acceptable. Costs money and takes about a minute, so use it where `cut` and `draw` genuinely cannot. Returns the generated image beside the original region so you can judge it. Beware: it produces something SIMILAR, not identical. If the answer depends on an exact orientation, count or arrangement, a similar picture is a wrong picture — cut instead when the region is clean.',
    input_schema: {
      type: 'object' as const,
      properties: {
        box: {
          type: 'array',
          items: { type: 'number' },
          description: '[ymin,xmin,ymax,xmax] 0-1000 — the drawing only, no text or option letters',
        },
        name: { type: 'string' },
      },
      required: ['box', 'name'],
    },
  },
  {
    name: 'review',
    description:
      'Lay out everything you are about to save, together, beside the original crop. Call this before `done`. Look at it as a whole: is each option its own drawing, is the figure the figure, has anything been cut from the wrong place? This is the last moment a mistake is cheap.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'check',
    description:
      'Run the deterministic checks the production system runs on a finished question. Returns the list of problems it finds. Free.',
    input_schema: {
      type: 'object' as const,
      properties: {
        stem: { type: 'string' },
        options: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              tex: { type: 'string' },
              image: { type: 'string', description: 'name of a cut or drawn image' },
            },
            required: ['label'],
          },
        },
        has_figure: { type: 'boolean' },
      },
      required: ['stem', 'options', 'has_figure'],
    },
  },
  {
    name: 'done',
    description:
      'The question is faithfully transcribed and you have verified it against the crop yourself.',
    input_schema: {
      type: 'object' as const,
      properties: {
        stem: { type: 'string', description: 'may be empty when the question is only a diagram' },
        options: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              tex: { type: 'string' },
              image: { type: 'string', description: 'name of a cut or drawn image' },
            },
            required: ['label'],
          },
        },
        figure: { type: 'string', description: 'name of the figure image, if any' },
        confidence: { type: 'number' },
        notes: { type: 'string', description: 'anything a reviewer should know' },
      },
      required: ['stem', 'options', 'confidence'],
    },
  },
  {
    name: 'give_up',
    description:
      'You cannot transcribe this faithfully. Say precisely what defeated you — this goes to a human, and a vague reason wastes their time.',
    input_schema: {
      type: 'object' as const,
      properties: { reason: { type: 'string' }, tried: { type: 'string' } },
      required: ['reason', 'tried'],
    },
  },
]

/** What a tool hands back to the model: text, images, or both. */
type ToolReturn = (ImageBlock | { type: 'text'; text: string })[]

export async function runAgentTool(
  ctx: AgentContext,
  name: string,
  input: Record<string, unknown>,
): Promise<ToolReturn> {
  if (name === 'look') {
    const box = asBox(input.box)
    const dataUrl = box ? await cropRegion(ctx.cropDataUrl, box) : ctx.cropDataUrl
    ctx.trace.push({ tool: 'look', summary: String(input.why ?? '') })
    return [await imageBlock(dataUrl)]
  }

  if (name === 'cut') {
    const box = asBox(input.box)
    if (!box) throw new Error('box [ymin,xmin,ymax,xmax] formatında olmalıdır')
    const key = String(input.name ?? 'cut')
    const dataUrl = await cropRegion(ctx.cropDataUrl, box)
    const reason = String(input.reason ?? '').trim()
    if (reason.length < 15) {
      throw new Error(
        'cut yalnız draw və generate uğursuz olandan sonra işlənir. reason sahəsində ' +
          'hansının nə cür alınmadığını yaz — yoxsa fiquru generate et.',
      )
    }
    ctx.artefacts.set(key, { name: key, dataUrl, source: 'cut', box, reason })
    ctx.trace.push({ tool: 'cut', summary: `${key} — ${reason.slice(0, 60)}` })
    // Judging a cut means judging WHAT was cut, and the answer is in the
    // picture, not in the coordinates. Five options that turned out to be
    // strips of the question text were all cut without anyone looking.
    return [
      { type: 'text', text: `"${key}" kəsildi:` },
      await imageBlock(dataUrl),
      {
        type: 'text',
        text: 'Bu, saxlamaq istədiyin məzmundurmu? Watermark üstündən keçirsə, kəsmə — çək və ya generate et.',
      },
    ]
  }

  if (name === 'draw') {
    const { node, dropped } = sanitizeSvg(String(input.svg ?? ''))
    if (!node || svgNodeCount(node) < 2) {
      throw new Error(
        `SVG qəbul edilmədi${dropped.length ? ` (${dropped.join(', ')})` : ''} — viewBox-lı tam <svg> lazımdır`,
      )
    }
    const key = String(input.name ?? 'figure')
    const dataUrl = await snapshotSvgNode(node)
    // A drawing that paints nothing is a defect now, not a discovery in review.
    const ink = await inkFraction(dataUrl)
    if (ink < 0.002) {
      throw new Error(
        'çəkilən fiqur boş render olundu — koordinatlar viewBox-dan kənarda ola bilər, ' +
          'ya da forma dolğusu/konturu görünmür. viewBox-a uyğun koordinatlarla və ' +
          'açıq stroke ilə yenidən göndər.',
      )
    }
    ctx.artefacts.set(key, { name: key, dataUrl, source: 'drawn', svg: node })
    ctx.trace.push({ tool: 'draw', summary: `${key} · ${svgNodeCount(node)} element` })

    // Both images, in one turn: judging a drawing against the thing it copies
    // is a comparison, and a model does that far better seeing them together
    // than reading a description of the difference.
    const against = asBox(input.against)
    const blocks: ToolReturn = [
      { type: 'text', text: 'Sənin çəkdiyin:' },
      await imageBlock(dataUrl),
    ]
    if (against) {
      blocks.push({ type: 'text', text: 'Uyğun gəlməli olan orijinal bölgə:' })
      blocks.push(await imageBlock(await cropRegion(ctx.cropDataUrl, against)))
    }
    blocks.push({
      type: 'text',
      text: dropped.length
        ? `Təmizlənən: ${dropped.join(', ')}. Fərq görürsənsə, düzəldilmiş SVG göndər.`
        : 'Fərq görürsənsə, düzəldilmiş SVG göndər.',
    })
    return blocks
  }

  if (name === 'generate') {
    const box = asBox(input.box)
    if (!box) throw new Error('box [ymin,xmin,ymax,xmax] formatında olmalıdır')
    const key = String(input.name ?? 'figure')
    const referenceUrl = await cropRegion(ctx.cropDataUrl, box)
    const reference = splitDataUrl(referenceUrl)
    const drawn = await opRedrawFigure({
      image: reference.image,
      mime: reference.mime as 'image/png' | 'image/jpeg',
    })
    const dataUrl = `data:${drawn.mime};base64,${drawn.image}`
    ctx.artefacts.set(key, { name: key, dataUrl, source: 'generated', box })
    ctx.trace.push({ tool: 'generate', summary: key })
    return [
      { type: 'text', text: 'Yaradılan:' },
      await imageBlock(dataUrl),
      { type: 'text', text: 'Orijinal bölgə:' },
      await imageBlock(referenceUrl),
      {
        type: 'text',
        text: 'Bu model OXŞAR çəkir, eyni yox. Forma, say, istiqamət və etiketlər üst-üstə düşürmü? Düşmürsə və bölgə təmizdirsə, kəsmək daha doğrudur.',
      },
    ]
  }

  if (name === 'review') {
    if (!ctx.artefacts.size) {
      return [{ type: 'text', text: 'Hələ heç bir şəkil saxlanmayıb.' }]
    }
    ctx.trace.push({ tool: 'review', summary: `${ctx.artefacts.size} şəkil` })
    const blocks: ToolReturn = [
      { type: 'text', text: 'Orijinal crop:' },
      await imageBlock(ctx.cropDataUrl),
      {
        type: 'text',
        text: `Saxlayacağın ${ctx.artefacts.size} şəkil, ardıcıllıqla:`,
      },
    ]
    for (const [key, art] of ctx.artefacts) {
      blocks.push({ type: 'text', text: `${key} (${art.source}):` })
      blocks.push(await imageBlock(art.dataUrl))
    }
    blocks.push({
      type: 'text',
      text: 'Hər biri olmalı olduğu şeydirmi? Biri sual mətnidirsə, ya səhv bölgədirsə, indi düzəlt — sonra düzəltmək olmayacaq.',
    })
    return blocks
  }

  if (name === 'check') {
    const options = (input.options as Record<string, unknown>[] | undefined) ?? []
    const question = {
      numberSeen: ctx.expectedNumber,
      stem: String(input.stem ?? ''),
      options: options.map((o) => ({
        label: String(o.label ?? ''),
        ...(o.tex ? { tex: String(o.tex) } : {}),
        ...(o.image ? { image: String(o.image), isImage: true } : {}),
      })),
      figures: input.has_figure
        ? { v: 1 as const, items: [{ kind: 'image' as const, src: 'agent' }] }
        : null,
      illegible: false,
      clipped: false,
      foreign: false,
      confidence: 1,
      warnings: [],
    } as unknown as ExtractedQuestion

    const flags: Flag[] = lintQuestion(question, ctx.expectedNumber)
    // An option naming an artefact that was never produced is the failure the
    // pipeline used to write to the database and call structured.
    for (const o of options) {
      const named = o.image ? String(o.image) : null
      if (named && !ctx.artefacts.has(named)) {
        flags.push({
          level: 'error',
          code: 'missing_artefact',
          message: `${o.label}: "${named}" adlı şəkil yoxdur — əvvəlcə cut və ya draw et`,
        })
      }
    }
    ctx.trace.push({ tool: 'check', summary: `${flags.length} qeyd` })
    return [
      {
        type: 'text',
        text: flags.length
          ? flags.map((f) => `[${f.level}] ${f.code}: ${f.message}`).join('\n')
          : 'Heç bir problem tapılmadı.',
      },
    ]
  }

  throw new Error(`naməlum alət: ${name}`)
}

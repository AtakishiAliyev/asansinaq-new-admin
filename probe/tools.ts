// The tools the agent works with.
//
// Two of them are the whole point of the experiment. `look` lets the model
// go back and examine a region closely instead of judging a page-sized crop
// once, which is what a person does when five option drawings are too small
// to place. `preview` hands the model its own output as an image, so it can
// see what it produced rather than trusting that it produced it — every
// failure this system had today was invisible from the inside.
//
// `cut` matters for a different reason: it gives the agent a free, exact
// alternative to paying an image model, and lets it decide which one the
// figure deserves.

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { Resvg } from '@resvg/resvg-js'
import { sanitizeSvg, svgNodeCount } from '../src/core/figures/svg-safe.ts'
import { lintQuestion } from '../src/core/questions/lint.ts'
import type { ExtractedQuestion } from '../src/core/questions/extraction.ts'

export interface ToolImage {
  type: 'image'
  source: { type: 'base64'; media_type: 'image/png'; data: string }
}

export interface ToolContext {
  /** the original crop, as it came out of segmentation */
  cropPath: string
  /** where this case writes its artefacts */
  outDir: string
  /** everything the agent produced, in order, for the report */
  artefacts: { name: string; file: string; note: string }[]
}

const png = (buf: Buffer): ToolImage => ({
  type: 'image',
  source: { type: 'base64', media_type: 'image/png', data: buf.toString('base64') },
})

async function record(ctx: ToolContext, name: string, buf: Buffer, note: string) {
  await mkdir(ctx.outDir, { recursive: true })
  const file = join(ctx.outDir, `${name}.png`)
  await writeFile(file, buf)
  ctx.artefacts.push({ name, file, note })
}

/** Boxes come in the same 0-1000 normalized form the pipeline already uses. */
function toPixels(
  box: number[],
  width: number,
  height: number,
): { left: number; top: number; width: number; height: number } {
  const [ymin, xmin, ymax, xmax] = box
  const left = Math.max(0, Math.round((xmin! / 1000) * width))
  const top = Math.max(0, Math.round((ymin! / 1000) * height))
  return {
    left,
    top,
    width: Math.max(1, Math.min(width - left, Math.round(((xmax! - xmin!) / 1000) * width))),
    height: Math.max(1, Math.min(height - top, Math.round(((ymax! - ymin!) / 1000) * height))),
  }
}

export const TOOL_DEFS = [
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
          description:
            '[ymin,xmin,ymax,xmax] 0-1000 normalized. Omit to see the whole crop.',
        },
        why: { type: 'string', description: 'what you are trying to see' },
      },
      required: ['why'],
    },
  },
  {
    name: 'cut',
    description:
      'Cut a region out of the original crop and keep it as an image for the question. This is free and pixel-exact — prefer it over drawing when the region is clean. Returns the cut image so you can check it.',
    input_schema: {
      type: 'object' as const,
      properties: {
        box: { type: 'array', items: { type: 'number' }, description: '[ymin,xmin,ymax,xmax] 0-1000' },
        name: { type: 'string', description: 'what this is, e.g. "option_A" or "figure"' },
      },
      required: ['box', 'name'],
    },
  },
  {
    name: 'draw',
    description:
      'Draw a figure as SVG. Returns your drawing rendered as an image, next to the region it should match, so you can judge it yourself and correct the SVG if it is wrong.',
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
        stem: { type: 'string' },
        options: { type: 'array', items: { type: 'object' } },
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

export async function runTool(
  ctx: ToolContext,
  name: string,
  input: Record<string, unknown>,
): Promise<(ToolImage | { type: 'text'; text: string })[]> {
  const crop = sharp(await readFile(ctx.cropPath))
  const meta = await crop.metadata()
  const W = meta.width!
  const H = meta.height!

  if (name === 'look') {
    const box = input.box as number[] | undefined
    if (!box) {
      return [
        { type: 'text', text: 'The whole crop:' },
        png(await sharp(await readFile(ctx.cropPath)).png().toBuffer()),
      ]
    }
    const region = toPixels(box, W, H)
    // Enlarged on purpose: the model is being asked to place things it said
    // it could not place, and at page scale five option drawings are a few
    // dozen pixels each.
    const scale = Math.min(4, Math.max(1, Math.round(900 / region.width)))
    const buf = await sharp(await readFile(ctx.cropPath))
      .extract(region)
      .resize({ width: region.width * scale, kernel: 'lanczos3' })
      .png()
      .toBuffer()
    return [
      { type: 'text', text: `Region ${JSON.stringify(box)} at ${scale}x:` },
      png(buf),
    ]
  }

  if (name === 'cut') {
    const region = toPixels(input.box as number[], W, H)
    const buf = await sharp(await readFile(ctx.cropPath)).extract(region).png().toBuffer()
    await record(ctx, String(input.name), buf, 'cut from the original')
    return [
      { type: 'text', text: `Cut "${input.name}". This is what it looks like — check it is the right region and nothing is clipped:` },
      png(buf),
    ]
  }

  if (name === 'draw') {
    const { node, dropped } = sanitizeSvg(String(input.svg))
    if (!node || svgNodeCount(node) < 2) {
      return [{ type: 'text', text: `The SVG did not parse: ${dropped.join(', ')}. Send valid <svg> markup with a viewBox.` }]
    }
    const rendered = new Resvg(String(input.svg), {
      fitTo: { mode: 'width', value: 700 },
      background: 'white',
    })
      .render()
      .asPng()
    await record(ctx, String(input.name), Buffer.from(rendered), 'drawn by the agent')

    const region = toPixels(input.against as number[], W, H)
    const target = await sharp(await readFile(ctx.cropPath))
      .extract(region)
      .resize({ width: 700, kernel: 'lanczos3' })
      .png()
      .toBuffer()
    return [
      { type: 'text', text: 'The region it must match:' },
      png(target),
      { type: 'text', text: 'Your drawing:' },
      png(Buffer.from(rendered)),
      {
        type: 'text',
        text: 'Compare them yourself. If anything is in the wrong place, missing, or the wrong shape, send a corrected SVG. Otherwise continue.',
      },
    ]
  }

  if (name === 'check') {
    const q = {
      numberSeen: 0,
      stem: String(input.stem ?? ''),
      options: (input.options as { label: string; tex?: string; image?: string }[]).map((o) => ({
        label: o.label,
        ...(o.tex ? { tex: o.tex } : {}),
        ...(o.image ? { image: o.image } : {}),
      })),
      figures: input.has_figure ? { v: 1 as const, items: [{ kind: 'image' as const, src: 'x' }] } : null,
      illegible: false,
      clipped: false,
      foreign: false,
      confidence: 1,
      warnings: [],
    }
    const flags = lintQuestion(q as ExtractedQuestion)
    return [
      {
        type: 'text',
        text: flags.length
          ? `Problems found:\n${flags.map((f) => `- ${f.level}: [${f.code}] ${f.message}`).join('\n')}`
          : 'No problems found.',
      },
    ]
  }

  return [{ type: 'text', text: 'unknown tool' }]
}

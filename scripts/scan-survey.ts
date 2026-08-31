// What the SCAN lane does to a sample of pages from a book with no text layer.
//
//   npm run survey:scan -- "local/books/X.pdf"            12 pages, spread out
//   npm run survey:scan -- "local/books/X.pdf" --pages 20
//   npm run survey:scan -- "local/books/X.pdf" --crops     also write the images
//
// COSTS MONEY: one vision call per page, about $0.004 each. Sampling is the
// point — three of the eleven books are image-only, 839 pages between them, and
// reading every page to find out whether the lane works would cost more than
// the answer is worth.
//
// The twin of `survey:pages`, and the same idea: it cannot know the right
// answer, so it asks whether a page agrees with its own neighbours — the count
// the book usually holds, numbers that form a run, and whether the ink actually
// grouped into as many blocks as the detector claimed questions.
//
// Detections are CACHED under local/survey/detections/. The vision call is the
// only part that costs anything, and the part being tuned — how the ink is
// grouped — is downstream of it, so re-measuring after a threshold change is
// free. `--refresh` asks the model again.
//
// It runs the REAL pipeline: the same request the Edge Function sends, the same
// `scanPageSeg`, and `renderCrops`, which is where the bands are re-measured
// against the page's ink. What it does not go through is the function wrapper,
// so nothing here is cached, budget-checked or written to the ledger.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { createCanvas } from '@napi-rs/canvas'
import Anthropic from '@anthropic-ai/sdk'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFPageProxy } from 'pdfjs-dist'
import { buildDetectQuestions } from '@/core/extract/request-gemini'
import { EMIT_DETECTION_TOOL_NAME, emitDetectionSchema } from '@/core/extract/tool-schema'
import { renderCrops } from '@/core/segment/crop'
import { scanDetectionSchema, scanPageSeg } from '@/core/segment/scan'
import { readEnvFile } from './env-file.ts'

const env = { ...readEnvFile('.env'), ...process.env }
if (!env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY lazımdır.')
  process.exit(2)
}
const MODEL = env.ANTHROPIC_UTILITY_MODEL ?? env.MODEL_TEXT ?? 'claude-haiku-4-5'
const DETECT_WIDTH_PX = 1600

const argv = process.argv.slice(2)
const wantCrops = argv.includes('--crops')
const refresh = argv.includes('--refresh')
const sampleSize = Number(argv[argv.indexOf('--pages') + 1]) || 12
const files = argv.filter((a) => !a.startsWith('--') && a.endsWith('.pdf'))
if (!files.length) {
  console.error('Bir və ya bir neçə PDF yolu verin.')
  process.exit(2)
}

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

/** The page as the import screen renders it for detection. */
async function renderForDetection(page: PDFPageProxy) {
  const base = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: Math.min(2, DETECT_WIDTH_PX / base.width) })
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvas: canvas as never, viewport }).promise
  return canvas.toBuffer('image/jpeg', 0.85).toString('base64')
}

/** The same request the Edge Function sends, with the shape forced by a tool. */
async function detect(imageBase64: string): Promise<{ raw: unknown; cost: number }> {
  const gemini = buildDetectQuestions({
    image: imageBase64,
    mime: 'image/jpeg',
  }) as unknown as {
    body: {
      contents: {
        parts: { text?: string; inlineData?: { mimeType: string; data: string } }[]
      }[]
    }
  }
  const parts = gemini.body.contents[0]?.parts ?? []
  const content = parts.map((p) =>
    p.text
      ? { type: 'text' as const, text: p.text }
      : {
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: p.inlineData!.mimeType as 'image/jpeg',
            data: p.inlineData!.data,
          },
        },
  )
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 8192,
    temperature: 0,
    messages: [{ role: 'user', content }],
    tools: [
      {
        name: EMIT_DETECTION_TOOL_NAME,
        description: 'Nəticəni bu alətlə qaytar.',
        input_schema: emitDetectionSchema as never,
      },
    ],
    tool_choice: { type: 'tool', name: EMIT_DETECTION_TOOL_NAME },
  })
  const tool = res.content.find((c) => c.type === 'tool_use')
  // Haiku's published rate, near enough for a survey line.
  const cost = (res.usage.input_tokens / 1e6) * 0.8 + (res.usage.output_tokens / 1e6) * 4
  return { raw: tool && 'input' in tool ? tool.input : null, cost }
}

interface Row {
  n: number
  detected: number
  cropped: number
  numbers: number[]
  notes: string[]
  flags: string[]
}

mkdirSync('local/survey', { recursive: true })
let spend = 0

for (const file of files) {
  const name = file.split('/').pop()!
  const doc = await getDocument({
    data: new Uint8Array(readFileSync(file)),
    useSystemFonts: true,
  }).promise

  // Spread the sample through the body of the book, skipping the covers where
  // a question page is not expected anyway.
  const first = Math.min(4, doc.numPages)
  const last = Math.max(first, doc.numPages - 2)
  const step = Math.max(1, Math.floor((last - first) / sampleSize))
  const targets: number[] = []
  for (let n = first; n <= last && targets.length < sampleSize; n += step) targets.push(n)

  const rows: Row[] = []
  for (const n of targets) {
    const page = await doc.getPage(n)
    try {
      const cacheDir = `local/survey/detections/${name}`
      const cacheFile = `${cacheDir}/p${n}.json`
      let raw: unknown
      if (!refresh && existsSync(cacheFile)) {
        raw = JSON.parse(readFileSync(cacheFile, 'utf8'))
      } else {
        const got = await detect(await renderForDetection(page))
        raw = got.raw
        spend += got.cost
        mkdirSync(cacheDir, { recursive: true })
        writeFileSync(cacheFile, JSON.stringify(raw))
      }
      if (!raw) {
        rows.push({ n, detected: 0, cropped: 0, numbers: [], notes: ['alət çağırılmadı'], flags: ['aşkarlama yoxdur'] })
        continue
      }
      const detection = scanDetectionSchema.parse(raw)
      const viewport = page.getViewport({ scale: 1 })
      const seg = scanPageSeg(detection, n, viewport.width, viewport.height)
      const result = await renderCrops(
        page,
        seg.bands,
        (w, h) => createCanvas(w, h) as never,
        { scanMode: true, scale: wantCrops ? 3 : 1.5 },
      )
      if (wantCrops) {
        mkdirSync(`local/survey/crops/${name}`, { recursive: true })
        for (const c of result.crops) {
          writeFileSync(
            `local/survey/crops/${name}/p${n}_q${c.number}.jpg`,
            Buffer.from(c.dataUrl.split(',')[1]!, 'base64'),
          )
        }
      }
      rows.push({
        n,
        detected: detection.anchors.length,
        cropped: result.crops.length,
        numbers: result.crops.map((c) => c.number),
        notes: result.notes ?? [],
        flags: [],
      })
    } catch (error) {
      rows.push({ n, detected: 0, cropped: 0, numbers: [], notes: [], flags: [`xəta: ${String(error).slice(0, 70)}`] })
    }
  }
  await (doc as unknown as { destroy?: () => Promise<void> }).destroy?.()

  // The same self-consistency questions survey:pages asks.
  const counts = new Map<number, number>()
  for (const r of rows) if (r.cropped) counts.set(r.cropped, (counts.get(r.cropped) ?? 0) + 1)
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0
  for (const r of rows) {
    if (!r.cropped) r.flags.push('sual tapılmadı')
    else {
      if (dominant >= 4 && r.cropped * 2 < dominant) r.flags.push(`az sual (${r.cropped}/${dominant})`)
      if (r.cropped !== r.detected) r.flags.push(`kəsim ${r.cropped} ≠ aşkarlanan ${r.detected}`)
      const sorted = [...r.numbers].sort((a, b) => a - b)
      if (sorted.length > 1) {
        if (new Set(sorted).size !== sorted.length) r.flags.push('nömrə təkrarlanır')
        else if (sorted[sorted.length - 1]! - sorted[0]! + 1 !== sorted.length) r.flags.push('nömrə buraxılıb')
      }
    }
    // The ink refused to group: the boxes stood, and they are the model's guess.
    if (r.notes.some((x) => x.includes('AI qutuları saxlanıldı'))) r.flags.push('mürəkkəbdən ölçülmədi')
  }

  const clean = rows.filter((r) => !r.flags.length).length
  console.log(
    `\n${name}  —  ${rows.length} səhifə seçildi, üstün ${dominant} sual/səh, təmiz ${clean}/${rows.length}`,
  )
  for (const r of rows) {
    const mark = r.flags.length ? '  ⚠ ' + r.flags.join(' · ') : ''
    console.log(`   s.${String(r.n).padStart(3)}  [${r.numbers.join(',')}]${mark}`)
  }
  writeFileSync(`local/survey/scan-${name}.json`, JSON.stringify(rows, null, 1))
}

console.log(`\nxərc: təxminən $${spend.toFixed(3)}`)

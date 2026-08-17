import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Crop } from '@/core/segment/types'
import type { FigureDoc, FigItem } from '@/core/figures/figspec'
import {
  isComplexSchemeFigure,
  wireToQuestion,
  type ExtractedQuestion,
} from '@/core/questions/extraction'
import { lintQuestion, worstLevel, type Flag } from '@/core/questions/lint'
import { compareQuestions, type FieldDiff } from '@/core/questions/compare'
import { snapshotFigure } from '@/components/question/snapshot'
import { PROMPT_VERSION } from '@/core/extract/prompts'
import {
  opCompareFigures,
  opExtract,
  opRedrawFigure,
} from '@/features/questions/api/question-ops'
import { cropRegion, splitDataUrl } from '@/features/questions/lib/image'
import type { QuestionRow } from '@/features/questions/schemas'

const CONCURRENCY = 3

export interface StructuringItem {
  row: QuestionRow
  crop: Crop
  /** display copy: image srcs are data URLs, ready to render */
  question?: ExtractedQuestion
  flags: Flag[]
  verified: boolean
  verifyDiffs: FieldDiff[]
  model?: string
  status: 'structured' | 'failed'
  error?: string
}

interface RunState {
  status: 'idle' | 'running' | 'done'
  current: number
  total: number
  items: StructuringItem[]
}

const IDLE: RunState = { status: 'idle', current: 0, total: 0, items: [] }

interface RunEntry {
  row: QuestionRow
  crop: Crop
}

// The exam MVP's processDraft orchestrator, rebuilt over the Edge Function:
// extract → lint → one repair retry (kept only if strictly fewer errors) →
// figure lanes (DSL render-compare / GPT-Image raster redraw, image options
// each redrawn from their own reference region) → hint-free second read →
// generated images to storage → one row UPDATE. The function only runs
// models; every decision happens here where lint and renderers live.
export function useStructuringRun() {
  const [state, setState] = useState<RunState>(IDLE)
  const runId = useRef(0)

  useEffect(
    () => () => {
      runId.current += 1
    },
    [],
  )

  const run = useCallback(async (entries: RunEntry[]) => {
    const id = ++runId.current
    setState({ status: 'running', current: 0, total: entries.length, items: [] })
    const items: StructuringItem[] = []
    let cursor = 0

    const processOne = async (entry: RunEntry): Promise<StructuringItem> => {
      const { row, crop } = entry
      const { image, mime } = splitDataUrl(crop.dataUrl)
      const original = { image, mime }
      const figureMode =
        crop.figureKind === 'none'
          ? ('plain' as const)
          : crop.figureKind === 'rule'
            ? ('dsl' as const)
            : ('raster' as const)

      const extractOnce = (repairNotes?: string, withHint = true) =>
        opExtract({
          image,
          mime,
          figureMode,
          textLayerHint: withHint ? crop.textLayer || undefined : undefined,
          testNo: row.test_no ?? undefined,
          expectedNumber: crop.number,
          repairNotes,
          // Scans have no hint to withhold, so the hint-free second read would
          // be a byte-identical call — cross-model agreement replaces it.
          modelSwap: !withHint && !crop.textLayer,
        })

      // Raster lane: the figure arrives from the image model AFTER this
      // extraction — its absence at lint time is by design, not an error.
      const lintLane = (q: ExtractedQuestion): Flag[] => {
        const fs = lintQuestion(q)
        return figureMode === 'raster'
          ? fs.filter((f) => f.code !== 'missing_figure')
          : fs
      }

      // The independent second read starts NOW: it reads the same crop and
      // never depends on the first read, so it costs no extra wall-clock.
      const secondPromise = extractOnce(undefined, false).catch(() => null)

      const first = await extractOnce()
      let wire = first.wire
      let question = wireToQuestion(wire)
      let flags = lintLane(question)

      // Auto-repair: feed the lint errors back once; keep the retry only when
      // it is strictly better.
      if (worstLevel(flags) === 'error') {
        const notes =
          'Əvvəlki cəhdində bu xətalar oldu, DÜZƏLT:\n' +
          flags
            .filter((f) => f.level === 'error')
            .map((f) => `- [${f.code}] ${f.message}`)
            .join('\n')
        try {
          const retry = await extractOnce(notes)
          const retryQuestion = wireToQuestion(retry.wire)
          const retryFlags = lintLane(retryQuestion)
          const errors = (fs: Flag[]) => fs.filter((f) => f.level === 'error').length
          if (errors(retryFlags) < errors(flags)) {
            wire = retry.wire
            question = retryQuestion
            flags = retryFlags
          }
        } catch {
          // repair attempt failed: keep the first read and its flags
        }
      }

      const pipelineFlags: Flag[] = []

      // Each attempt is a fresh function invocation with its own wall-clock
      // budget — one client-side retry covers slow gpt-image generations.
      const redrawSafe = async (img: { image: string; mime: 'image/png' | 'image/jpeg' }) => {
        try {
          return await opRedrawFigure(img)
        } catch {
          return await opRedrawFigure(img)
        }
      }

      // Image options: each one is redrawn from its own reference region and
      // verified against that region — one bad option is a wrong question.
      // All options run in PARALLEL (a 5-image-option question would
      // otherwise serialize five 30-60s generations).
      const imageOptionBoxes = new Map<string, [number, number, number, number]>()
      for (const o of wire.options) {
        if (o.is_image && o.box) {
          imageOptionBoxes.set(o.label, o.box as [number, number, number, number])
        }
      }
      const processOption = async (option: (typeof question.options)[number]) => {
        const box = imageOptionBoxes.get(option.label)
        if (!box) return
        try {
          const referenceUrl = await cropRegion(crop.dataUrl, box)
          const reference = splitDataUrl(referenceUrl)
          const redrawn = await redrawSafe(reference)
          option.image = `data:${redrawn.mime};base64,${redrawn.image}`
          const cmp = await opCompareFigures(reference, {
            image: redrawn.image,
            mime: redrawn.mime as 'image/png' | 'image/jpeg',
          })
          if (!cmp.match) {
            pipelineFlags.push({
              level: 'error',
              code: 'option_figure_mismatch',
              message: `${option.label} variantının şəkli orijinala uyğun gəlmir: ${(cmp.differences ?? []).join('; ')}`,
            })
          }
        } catch (error) {
          // A lost option image must not kill the whole question — the text
          // is already extracted; flag it and let review deal with it.
          pipelineFlags.push({
            level: 'error',
            code: 'option_figure_failed',
            message: `${option.label} variantının şəkli yaradıla bilmədi: ${error instanceof Error ? error.message : 'naməlum xəta'}`,
          })
        }
      }

      // Figure lanes.
      const rasterRedraw = async (): Promise<void> => {
        const redrawn = await redrawSafe(original)
        const item: FigItem = {
          kind: 'image',
          src: `data:${redrawn.mime};base64,${redrawn.image}`,
        }
        question.figures = { v: 1, items: [item] } as FigureDoc
        const cmp = await opCompareFigures(original, {
          image: redrawn.image,
          mime: redrawn.mime as 'image/png' | 'image/jpeg',
        })
        if (!cmp.match) {
          const retry = await redrawSafe(original)
          const retryDataUrl = `data:${retry.mime};base64,${retry.image}`
          const cmp2 = await opCompareFigures(original, {
            image: retry.image,
            mime: retry.mime as 'image/png' | 'image/jpeg',
          })
          question.figures = {
            v: 1,
            items: [{ kind: 'image', src: retryDataUrl }],
          } as FigureDoc
          if (!cmp2.match) {
            pipelineFlags.push({
              level: 'error',
              code: 'raster_mismatch',
              message: `yaradılan fiqur orijinala uyğun gəlmir: ${(cmp2.differences ?? []).join('; ')}`,
            })
          }
        }
      }

      const figureWork = async () => {
        try {
          if (figureMode === 'raster') {
            await rasterRedraw()
          } else if (figureMode === 'dsl' && question.figures?.items.length) {
            const figures = question.figures
            if (isComplexSchemeFigure(figures)) {
              await rasterRedraw()
            } else {
              try {
                const snapshot = await snapshotFigure(figures)
                const cmp = await opCompareFigures(original, splitDataUrl(snapshot))
                if (!cmp.match) await rasterRedraw()
              } catch {
                await rasterRedraw()
              }
            }
          }
        } catch (error) {
          // Same principle as options: keep the structured text, flag the
          // missing figure loudly, land in the attention queue.
          pipelineFlags.push({
            level: 'error',
            code: 'figure_failed',
            message: `fiqur yaradıla bilmədi: ${error instanceof Error ? error.message : 'naməlum xəta'}`,
          })
        }
      }

      await Promise.all([
        figureWork(),
        ...question.options.map((o) => processOption(o)),
      ])

      // Independence lever: the second read gets no text-layer hint; agreement
      // between two blind-ish reads is what earns `verified`.
      let secondEqual = false
      let verifyDiffs: FieldDiff[] = []
      const second = await secondPromise
      if (second) {
        const textOnly = (q: ExtractedQuestion): ExtractedQuestion => ({
          ...q,
          figures: null,
        })
        const cmp = compareQuestions(
          textOnly(question),
          textOnly(wireToQuestion(second.wire)),
        )
        verifyDiffs = cmp.diffs
        secondEqual = cmp.equal
      } else {
        pipelineFlags.push({
          level: 'warning',
          code: 'second_read_failed',
          message: 'ikinci oxunuş alınmadı — müstəqil təsdiq yoxdur',
        })
      }

      // Final flags reflect the FINAL question (figures attached), plus
      // everything the pipeline itself observed along the way.
      flags = [...lintLane(question), ...pipelineFlags]
      const verified = secondEqual && worstLevel(flags) !== 'error'

      // Persist generated images (never base64 in rows), then the row.
      const uploadDataUrl = async (dataUrl: string, path: string) => {
        const { image: b64, mime: m } = splitDataUrl(dataUrl)
        const bin = atob(b64)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        const { error } = await supabase.storage
          .from('question-crops')
          .upload(path, new Blob([bytes], { type: m }), {
            upsert: true,
            contentType: m,
          })
        if (error) throw error
        return path
      }
      const keyBase = `${row.book_id}/p${row.page_number}_c${row.col}_q${row.q_no}`
      const dbOptions = await Promise.all(
        question.options.map(async (o) => ({
          label: o.label,
          tex: o.tex,
          image: o.image?.startsWith('data:')
            ? await uploadDataUrl(o.image, `${keyBase}_opt${o.label}.png`)
            : o.image,
        })),
      )
      let dbFigures: FigureDoc | null = question.figures ?? null
      if (dbFigures) {
        const dbItems = await Promise.all(
          dbFigures.items.map(async (item, i) =>
            item.kind === 'image' && item.src.startsWith('data:')
              ? { ...item, src: await uploadDataUrl(item.src, `${keyBase}_fig${i}.png`) }
              : item,
          ),
        )
        dbFigures = { ...dbFigures, items: dbItems }
      }

      const aiDifficulty =
        typeof wire.difficulty === 'number' ? wire.difficulty : null
      const { error: updateError } = await supabase
        .from('questions')
        .update({
          status: 'structured',
          stem: question.stem,
          options: dbOptions,
          figures: dbFigures as never,
          ai_difficulty: aiDifficulty,
          model: first.model,
          prompt_version: PROMPT_VERSION,
          flags: flags as never,
          verified,
          extraction_error: null,
        })
        .eq('id', row.id)
      if (updateError) throw updateError

      return {
        row,
        crop,
        question,
        flags,
        verified,
        verifyDiffs,
        model: first.model,
        status: 'structured',
      }
    }

    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (cursor < entries.length) {
          if (runId.current !== id) return
          const entry = entries[cursor++]
          let item: StructuringItem
          try {
            item = await processOne(entry)
          } catch (error) {
            const message =
              error instanceof Error ? error.message : 'naməlum xəta'
            await supabase
              .from('questions')
              .update({ status: 'failed', extraction_error: message })
              .eq('id', entry.row.id)
              .then(() => undefined)
            item = {
              row: entry.row,
              crop: entry.crop,
              flags: [],
              verified: false,
              verifyDiffs: [],
              status: 'failed',
              error: message,
            }
          }
          if (runId.current !== id) return
          items.push(item)
          setState({
            status: 'running',
            current: items.length,
            total: entries.length,
            items: [...items],
          })
        }
      }),
    )

    if (runId.current === id) {
      setState({
        status: 'done',
        current: items.length,
        total: entries.length,
        items,
      })
    }
    return items
  }, [])

  const reset = useCallback(() => {
    runId.current++
    setState(IDLE)
  }, [])

  const stop = useCallback(() => {
    runId.current++
    setState((current) =>
      current.status === 'running' ? { ...current, status: 'done' } : current,
    )
  }, [])

  return { ...state, run, reset, stop }
}

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
  opSuggestCategory,
  OpError,
} from '@/features/questions/api/question-ops'
import { fetchBookAnswerKeys } from '@/features/questions/api/answer-keys'
import { cropRegion, splitDataUrl } from '@/features/questions/lib/image'
import {
  isBudgetExhausted,
  resetRateGate,
} from '@/features/questions/lib/rate-gate'
import type { QuestionRow } from '@/features/questions/schemas'

// Questions in flight. The real ceiling is the providers' rate limits, which
// the shared gate enforces per call — this only decides how many questions
// are being assembled at once.
const CONCURRENCY = 8

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

// A row the reviewer already ruled on keeps its verdict: re-extracting is a
// repair of the CONTENT, never a silent un-approval.
const REVIEWED = new Set(['approved', 'rejected'])

/** The subject's category tree, sent so the model picks an EXISTING id. */
export interface CategoryOption {
  id: number
  name: string
  parentId: number | null
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

  const run = useCallback(async (
    entries: RunEntry[],
    categories: CategoryOption[] = [],
  ) => {
    const id = ++runId.current
    resetRateGate()
    // One lookup per run: the printed key, if this book has one imported.
    const bookId = entries[0]?.row.book_id
    const answerKeys = bookId
      ? await fetchBookAnswerKeys(bookId).catch(() => new Map<string, string>())
      : new Map<string, string>()
    setState({ status: 'running', current: 0, total: entries.length, items: [] })
    const items: StructuringItem[] = []
    let cursor = 0

    // Thrown when the operator stopped the run; the worker loop treats it as
    // "leave this row alone", not as a failure worth recording.
    const CANCELLED = Symbol('cancelled')
    const checkCancelled = () => {
      if (runId.current !== id) throw CANCELLED
    }

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

      const extractOnce = async (repairNotes?: string, withHint = true) => {
        checkCancelled()
        const call = () =>
          opExtract({
            image,
            mime,
            figureMode,
            textLayerHint: withHint ? crop.textLayer || undefined : undefined,
            testNo: row.test_no ?? undefined,
            expectedNumber: crop.number,
            repairNotes,
            // Scans have no hint to withhold, so the hint-free second read
            // would be a byte-identical call — a swapped model class restores
            // the independence the missing hint used to provide.
            modelSwap: !withHint && !crop.textLayer,
          })
        try {
          return await call()
        } catch (error) {
          checkCancelled()
          if (error instanceof OpError && error.kind === 'budget') throw error
          return await call()
        }
      }

      // Raster lane: the figure arrives from the image model AFTER this
      // extraction — its absence at lint time is by design, not an error.
      const lintLane = (q: ExtractedQuestion): Flag[] => {
        const fs = lintQuestion(q, crop.number)
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
      const redrawSafe = async (
        img: { image: string; mime: 'image/png' | 'image/jpeg' },
        attempt = 0,
      ) => {
        checkCancelled()
        try {
          return await opRedrawFigure({ ...img, attempt })
        } catch (error) {
          checkCancelled()
          if (error instanceof OpError && error.kind === 'budget') throw error
          return await opRedrawFigure({ ...img, attempt })
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

      // Figure lanes. The reference is the figure's own region when the
      // model reported one: a whole-question reference makes the image model
      // redraw the stem and the options into the picture (duplicated content)
      // and costs far more time than the drawing alone.
      const figureBox = Array.isArray(wire.figure_box)
        ? (wire.figure_box.slice(0, 4) as [number, number, number, number])
        : null
      const figureReference = async () => {
        if (!figureBox) return original
        try {
          return splitDataUrl(await cropRegion(crop.dataUrl, figureBox))
        } catch {
          return original
        }
      }

      const rasterRedraw = async (): Promise<void> => {
        const reference = await figureReference()
        const redrawn = await redrawSafe(reference)
        const item: FigItem = {
          kind: 'image',
          src: `data:${redrawn.mime};base64,${redrawn.image}`,
        }
        question.figures = { v: 1, items: [item] } as FigureDoc
        // Compare against the same region that was redrawn, or the comparison
        // reports the missing stem and options as differences.
        const cmp = await opCompareFigures(reference, {
          image: redrawn.image,
          mime: redrawn.mime as 'image/png' | 'image/jpeg',
        })
        if (!cmp.match) {
          // attempt=1 busts the op cache — a retry that replays the same
          // cached image could never produce a different figure.
          const retry = await redrawSafe(reference, 1)
          const retryDataUrl = `data:${retry.mime};base64,${retry.image}`
          const cmp2 = await opCompareFigures(reference, {
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

      // What the FIRST read actually said, before the pipeline attached
      // generated figures/images. The second read is compared against this —
      // otherwise every raster question "disagrees" with itself.
      const firstRead: ExtractedQuestion = {
        ...question,
        options: question.options.map((o) => ({ ...o })),
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
                const cmp = await opCompareFigures(
                  await figureReference(),
                  splitDataUrl(snapshot),
                )
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
        // Figures ARE compared here (coarse kind signature) because both
        // sides are raw reads now; pixel fidelity is validated separately by
        // render-and-compare against the original crop.
        const cmp = compareQuestions(firstRead, wireToQuestion(second.wire))
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

      // The answer comes from the printed key or from the reviewer — never
      // from a model solving the question. A machine-authored answer would
      // look exactly like a verified one in the bank, and a wrong one is
      // worse than none: a student would be marked wrong for being right.
      const keyAnswer =
        answerKeys.get(`${row.test_no ?? 0}:${row.q_no}`) ??
        answerKeys.get(`0:${row.q_no}`) ??
        null
      if (!keyAnswer) {
        pipelineFlags.push({
          level: 'warning',
          code: 'answer_missing',
          message: 'Cavab yoxdur — cavab açarını idxal edin və ya əl ilə seçin',
        })
      }

      // Category suggestion: cheap, and the reviewer confirms it anyway. A
      // hallucinated id is rejected here, not written to the row.
      let aiCategoryId: number | null = null
      let aiCategoryConfidence: number | null = null
      if (categories.length && question.stem) {
        try {
          checkCancelled()
          const suggestion = await opSuggestCategory({
            stem: question.stem,
            options: question.options.map((o) => o.tex ?? '[şəkil]'),
            categories,
          })
          const id = suggestion.category_id ?? null
          if (id !== null && categories.some((c) => c.id === id)) {
            aiCategoryId = id
            aiCategoryConfidence = suggestion.confidence
          }
        } catch {
          // a missing suggestion just means the reviewer picks manually
        }
      }

      // An empty stem can never satisfy the row's CHECK constraint, and the
      // raw Postgres error would replace every pipeline flag with noise.
      if (!question.stem.trim()) {
        await supabase
          .from('questions')
          .update({
            status: REVIEWED.has(row.status) ? row.status : 'failed',
            flags: [...lintLane(question), ...pipelineFlags] as never,
            verified: false,
            extraction_error:
              'Sual mətni oxunmadı — crop-u yenidən kəsin və ya əl ilə daxil edin',
          })
          .eq('id', row.id)
        return {
          row,
          crop,
          flags: [...lintLane(question), ...pipelineFlags],
          verified: false,
          verifyDiffs: [],
          status: 'failed',
          error: 'sual mətni boş çıxdı',
        }
      }

      const aiDifficulty =
        typeof wire.difficulty === 'number' ? wire.difficulty : null
      const { error: updateError } = await supabase
        .from('questions')
        .update({
          status: REVIEWED.has(row.status) ? row.status : 'structured',
          stem: question.stem,
          options: dbOptions,
          figures: dbFigures as never,
          ai_difficulty: aiDifficulty,
          // A reviewer's answer outranks anything the pipeline produces.
          ...(row.answer_source !== 'reviewer' && keyAnswer
            ? {
                answer: keyAnswer,
                answer_source: 'key' as const,
                answer_confidence: null,
              }
            : {}),
          // Only overwrite the suggestion when one was actually requested —
          // a restructure without a category tree must not erase the old one.
          ...(categories.length
            ? {
                ai_category_id: aiCategoryId,
                ai_category_confidence: aiCategoryConfidence,
              }
            : {}),
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
          // The day's budget is spent: leave the rest untouched rather than
          // marking every remaining question failed.
          if (isBudgetExhausted()) return
          const entry = entries[cursor++]
          let item: StructuringItem
          try {
            item = await processOne(entry)
          } catch (error) {
            if (error === CANCELLED) return
            const message =
              error instanceof Error ? error.message : 'naməlum xəta'
            await supabase
              .from('questions')
              .update({
                status: REVIEWED.has(entry.row.status)
                  ? entry.row.status
                  : 'failed',
                extraction_error: message,
              })
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
          items.push(item)
          if (runId.current !== id) return
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

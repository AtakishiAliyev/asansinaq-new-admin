import {
  buildAnthropicExtract,
  type AnthropicExtractInput,
  type CategoryOption,
} from '@/core/extract/request-anthropic'
import {
  EMIT_QUESTION_TOOL_NAME,
  emitQuestionSchema,
} from '@/core/extract/tool-schema'
import { extractResponseSchema } from '@/core/extract/schemas'
import { EXTRACT_SYSTEM } from '@/core/extract/prompts'
import { FEWSHOT_FIGURES } from '@/core/extract/fewshot'
import { deepEq, eq, notOk, ok, suite } from '../harness.ts'

const CATEGORIES: CategoryOption[] = [
  { id: 1, name: 'Cəbr', parentId: null },
  { id: 2, name: 'Tənliklər', parentId: 1 },
]

const base: AnthropicExtractInput = {
  image: 'AAAA',
  mime: 'image/png',
  hasFigure: false,
  textLayerHint: '12. x + 1 = 3',
  expectedNumber: 12,
  categories: CATEGORIES,
}

const build = (patch: Partial<AnthropicExtractInput> = {}) =>
  buildAnthropicExtract({ ...base, ...patch })

const systemText = (r: ReturnType<typeof build>): string => {
  const s = r.params.system
  ok(Array.isArray(s), 'system olmalıdır blok massivi')
  const first = (s as { type: string; text: string }[])[0]
  return first?.text ?? ''
}

/** Every object node reachable in the tool schema. */
function objectNodes(node: unknown, found: Record<string, unknown>[] = []) {
  if (Array.isArray(node)) {
    for (const item of node) objectNodes(item, found)
    return found
  }
  if (node === null || typeof node !== 'object') return found
  const rec = node as Record<string, unknown>
  if (rec.type === 'object') found.push(rec)
  for (const value of Object.values(rec)) objectNodes(value, found)
  return found
}

/** Properties an object declares but does not require — what strict tool use
 *  counts, and caps at 24. */
function countOptional(node: unknown): number {
  let total = 0
  for (const object of objectNodes(node)) {
    const properties = Object.keys(
      (object.properties as Record<string, unknown> | undefined) ?? {},
    )
    const required = new Set((object.required as string[] | undefined) ?? [])
    total += properties.filter((name) => !required.has(name)).length
  }
  return total
}

function hasKeyAnywhere(node: unknown, key: string): boolean {
  if (Array.isArray(node)) return node.some((n) => hasKeyAnywhere(n, key))
  if (node === null || typeof node !== 'object') return false
  const rec = node as Record<string, unknown>
  if (key in rec) return true
  return Object.values(rec).some((v) => hasKeyAnywhere(v, key))
}

export const anthropicRequestSuite = suite('anthropic-request', {
  // The prompt is the asset. A builder that paraphrases it, or quietly drops a
  // rule while assembling, would be invisible until extraction quality moved.
  'the copy-only rules are reused verbatim, not rewritten'() {
    ok(systemText(build()).includes(EXTRACT_SYSTEM))
  },

  // Fewshots used to ride in the per-question user text, where they are paid
  // for on every single question. In the system block they are paid for once
  // per cache window.
  'the figure fewshots sit in the cached system block, not the user turn'() {
    const r = build()
    ok(systemText(r).includes(FEWSHOT_FIGURES), 'fewshots sistem blokunda deyil')
    const userText = JSON.stringify(r.params.messages[0]?.content)
    notOk(userText.includes(FEWSHOT_FIGURES), 'fewshots istifadəçi mesajında qaldı')
  },

  'the system block carries a cache breakpoint'() {
    const s = build().params.system as { cache_control?: unknown }[]
    ok(s[0]?.cache_control, 'sistem blokunda cache_control yoxdur')
  },

  // THE cache invariant. Anthropic matches the prefix byte for byte, so
  // anything unstable above a breakpoint means every question pays full price
  // while the code still reads as if caching were on. Nothing reports this —
  // cache_read_input_tokens just stays zero.
  'two questions from one book share a byte-identical cached prefix'() {
    const a = build({ image: 'AAAA', textLayerHint: '12. x = 1', expectedNumber: 12 })
    const b = build({ image: 'BBBB', textLayerHint: '13. y = 2', expectedNumber: 13 })
    deepEq(a.params.tools, b.params.tools, 'alətlər fərqlidir')
    deepEq(a.params.system, b.params.system, 'sistem bloku fərqlidir')
    const treeOf = (r: typeof a) =>
      (r.params.messages[0]?.content as { text?: string }[])[0]?.text
    deepEq(treeOf(a), treeOf(b), 'kateqoriya ağacı fərqlidir')
  },

  // The lane changes the model, and the model is part of the cache key — but
  // it must not change the prompt, or the two tiers could never share a
  // baseline in an eval.
  'the figure lane and the text lane send the same prompt'() {
    deepEq(
      build({ hasFigure: true }).params.system,
      build({ hasFigure: false }).params.system,
    )
    eq(build({ hasFigure: true }).lane, 'figure')
    eq(build({ hasFigure: false }).lane, 'text')
  },

  // Order is not cosmetic: a breakpoint covers everything above it, so the one
  // stable-per-book block has to precede the crop and the per-question text.
  'the cached tree precedes the crop, and the crop precedes its question text'() {
    const content = build().params.messages[0]?.content as {
      type: string
      cache_control?: unknown
    }[]
    deepEq(
      content.map((c) => c.type),
      ['text', 'image', 'text'],
    )
    ok(content[0]?.cache_control, 'ağac bloku keşlənmir')
    notOk(content[2]?.cache_control, 'sual mətni keşlənməməlidir')
  },

  'a book with no categories sends no tree block at all'() {
    const content = build({ categories: [] }).params.messages[0]?.content as {
      type: string
    }[]
    deepEq(
      content.map((c) => c.type),
      ['image', 'text'],
    )
  },

  // Four is the hard ceiling. Two is the budget; anything that quietly adds a
  // third is spending headroom a later stage will want.
  'the request stays well inside the four-breakpoint ceiling'() {
    const r = build()
    const blocks = [
      ...(r.params.system as { cache_control?: unknown }[]),
      ...(r.params.messages[0]?.content as { cache_control?: unknown }[]),
      ...(r.params.tools ?? []).map((t) => t as { cache_control?: unknown }),
    ]
    eq(blocks.filter((b) => b.cache_control).length, 2)
  },

  'the tool is forced, and only one of it'() {
    const r = build()
    deepEq(r.params.tool_choice, {
      type: 'tool',
      name: EMIT_QUESTION_TOOL_NAME,
      disable_parallel_tool_use: true,
    })
    eq(r.params.tools?.length, 1)
  },

  // A live batch rejected every figure-lane request with "`temperature` is
  // deprecated for this model". Sampling parameters are removed on the current
  // models and accepted on older ones, and this module resolves a lane rather
  // than a model id, so it cannot tell which it is addressing. The worker adds
  // them back where the configured model takes them.
  'no sampling parameter is sent from here, because the model is not known yet'() {
    const params = build().params as Record<string, unknown>
    for (const key of ['temperature', 'top_p', 'top_k']) {
      notOk(key in params, `${key} göndərilir — model bilinmədən olmaz`)
    }
  },

  // Strict tool use compiles the schema into a grammar and caps it at 24
  // optional parameters. The flat figure union has 63, so the two cannot
  // coexist: a live batch failed every text-lane request on exactly this.
  // Turning strict back on means giving the figures a real discriminated union
  // first, not trimming a field or two.
  'the tool is not strict, which the flat union cannot satisfy'() {
    const tool = build().params.tools?.[0] as { strict?: boolean }
    notOk(tool.strict, 'strict yenidən açılıb — 24 optional limitini yoxlayın')
    const optional = countOptional(emitQuestionSchema)
    ok(
      optional > 24,
      `optional sahə sayı ${optional} — 24-dən aşağı düşübsə, strict yenidən mümkündür`,
    )
  },

  // `nullable` is Gemini's spelling and is not a JSON Schema keyword. It is not
  // rejected in a way that names itself — it is simply ignored, and the field
  // it guarded stops being described.
  'no Gemini-only keyword survives into the tool schema'() {
    notOk(hasKeyAnywhere(emitQuestionSchema, 'nullable'))
  },

  'every object in the schema closes itself'() {
    const nodes = objectNodes(emitQuestionSchema)
    ok(nodes.length > 3, `gözlənilən çox obyekt, tapılan ${nodes.length}`)
    for (const node of nodes) {
      eq(node.additionalProperties, false, 'additionalProperties açıq qalıb')
      ok(Array.isArray(node.required), 'required yoxdur')
    }
  },

  // The flat figure union is deliberate and load bearing: wireFigure and the
  // extraction fixtures both read it. A schema redesign has to be its own
  // change, with its own before/after.
  'the figure shape stays the flat union wireFigure expects'() {
    const figures = (
      emitQuestionSchema.properties as Record<
        string,
        { items?: { properties?: Record<string, unknown> } }
      >
    ).figures
    const props = figures?.items?.properties ?? {}
    ok('kind' in props, 'kind sahəsi yoxdur')
    for (const key of ['panels', 'venn_shapes', 'cubes', 'box', 'table']) {
      ok(key in props, `${key} düz birlikdən düşüb`)
    }
    // The automated lane no longer offers a free-drawn escape hatch. A figure
    // no kind expresses is cut from the crop and cleaned, which cannot
    // hallucinate; a model asked to draw what it cannot express writes an
    // apology into the drawing instead of failing.
    ok(!('raw_svg' in props), 'raw_svg hələ də modelə təklif olunur')
    const kinds = (props.kind as { enum?: string[] })?.enum ?? []
    ok(!kinds.includes('raw_svg'), 'raw_svg hələ də kind siyahısındadır')
    ok(kinds.includes('image'), 'image son çarə kimi təklif olunmur')
  },

  // Folding the category in removes a whole call per question. The pipeline
  // acts on both fields, so both owe the model a definition — the same rule
  // eval/suites/prompts.ts enforces on the Gemini schema.
  'the folded-in category fields are described to the model'() {
    const props = emitQuestionSchema.properties as Record<
      string,
      { description?: string }
    >
    for (const field of ['category_id', 'category_confidence']) {
      ok(
        (props[field]?.description ?? '').length > 20,
        `${field} təsviri yoxdur`,
      )
    }
    ok(/never guess|omit this field/i.test(props.category_id?.description ?? ''))
  },

  // schemas.ts is still live on the Gemini lane. Adding a field there would
  // change what the running pipeline asks for and invalidate its ops_cache, for
  // a lane that is not wired up yet — so the category fields exist only on the
  // Anthropic tool, and this is what keeps them there.
  'folding the category in left the live Gemini schema untouched'() {
    const gemini = extractResponseSchema.properties as Record<string, unknown>
    notOk('category_id' in gemini, 'Gemini sxeminə kateqoriya sızıb')
    notOk('category_confidence' in gemini, 'Gemini sxeminə etibar sızıb')
    const anthropic = emitQuestionSchema.properties
    ok('category_id' in anthropic, 'Anthropic sxemində kateqoriya yoxdur')
  },
})

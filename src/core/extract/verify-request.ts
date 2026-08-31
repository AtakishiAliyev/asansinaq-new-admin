// The second wave: our rendering of a question, against the printed original.
//
// Structured like the extract request and for the same reasons — a stable
// cached prefix, a forced tool, temperature left to the caller. The difference
// is that BOTH images are per-question, so there is much less to cache here
// and the prefix is only the prompt and the schema. That is fine; the wave is
// one call per question and the prompt is small.
//
// The two images are labelled in the text rather than left to order. A model
// handed two pictures and asked "are these the same" will sometimes report the
// difference backwards, which turns a correct recreation into a flagged one and
// a reviewer's time into noise.
import type Anthropic from '@anthropic-ai/sdk'
import { VERIFY_QUESTION_PROMPT } from '@/core/extract/prompts'

export const EMIT_VERDICT_TOOL_NAME = 'emit_verdict'

/** Where a difference was found. Kept coarse: the reviewer opens the row anyway. */
export const VERDICT_FIELDS = [
  'stem',
  'option_a',
  'option_b',
  'option_c',
  'option_d',
  'option_e',
  'option_count',
  'figure',
  'figure_marks',
  'asked_quantity',
  'other',
] as const

export const verdictSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    // Three parallel arrays rather than one array of {field, severity, note}.
    //
    // The nested shape is the natural one and it does not survive contact with
    // the model: roughly a fifth of live calls came back with `differences` set
    // to a STRING containing leaked `<parameter name="note">` markup, and the
    // verdict was unreadable. Every one of those had found the defect — the
    // content was right and only the shape was wrong, so the schema was costing
    // real catches. Arrays of enums and arrays of strings do not provoke it.
    //
    // The three are index-aligned; `parseVerdict` zips them and tolerates a
    // ragged tail.
    difference_fields: {
      type: 'array',
      description:
        'Which part of the question each difference is in. One entry per difference, aligned with difference_severities and difference_notes.',
      items: { type: 'string', enum: [...VERDICT_FIELDS] },
    },
    difference_severities: {
      type: 'array',
      description:
        'How bad each difference is, aligned with difference_fields. Any missing or extra figure element is always critical.',
      items: { type: 'string', enum: ['critical', 'minor'] },
    },
    difference_notes: {
      type: 'array',
      description:
        'What differs, concretely: what the original shows and what the recreation shows instead. Aligned with difference_fields.',
      items: { type: 'string' },
    },
    matches: {
      type: 'boolean',
      description:
        'True only if the recreation asks the same question with the same data. Any critical difference means false.',
    },
    confidence: {
      type: 'number',
      description:
        'How certain THIS COMPARISON is, 0 to 1 — not how hard the question is. Lower it when the crop is unclear or the figure is hard to read.',
    },
  },
  required: [
    'difference_fields',
    'difference_severities',
    'difference_notes',
    'matches',
    'confidence',
  ],
} as const

export interface VerifyInput {
  /** The crop, base64 without the data: prefix. */
  original: { image: string; mime: 'image/png' | 'image/jpeg' }
  /** Our render, base64 PNG. */
  recreation: { image: string }
  /** What the recreated figure claims, from `describeFigure`. */
  figureClaims?: string | null
}

export interface VerifyRequest {
  params: Omit<Anthropic.MessageCreateParamsNonStreaming, 'model'>
}

const TOOL: Anthropic.Tool = {
  name: EMIT_VERDICT_TOOL_NAME,
  description:
    'Report every difference between the original question and the recreation, then the verdict. Differences first: an empty list is an assertion, not a default.',
  input_schema: verdictSchema as unknown as Anthropic.Tool.InputSchema,
}

export function buildVerifyRequest(input: VerifyInput): VerifyRequest {
  return {
    params: {
      // The prompt asks for every difference enumerated BEFORE the verdict, and
      // a forced tool means that enumeration IS the tool input. Run out of
      // tokens mid-JSON and the block arrives incomplete: no verdict, no
      // differences, nothing to read. That is not a rare edge — it happened to
      // four of eighteen calls in the first figure-corruption run, and because
      // `parseVerdict` correctly refuses to call an unreadable verdict a match,
      // every one of them looked like a successful catch.
      max_tokens: 4096,
      system: [
        {
          type: 'text',
          text: VERIFY_QUESTION_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: [TOOL],
      tool_choice: {
        type: 'tool',
        name: EMIT_VERDICT_TOOL_NAME,
        disable_parallel_tool_use: true,
      },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: '(1) ORİJİNAL — kitabdan kəsilmiş sual:' },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: input.original.mime,
                data: input.original.image,
              },
            },
            { type: 'text', text: '(2) YENİDƏN YARADILMIŞ — bizim versiyamız:' },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: input.recreation.image,
              },
            },
            ...(input.figureClaims
              ? [
                  {
                    type: 'text' as const,
                    text:
                      'YENİDƏN YARADILMIŞ fiqurun İDDİALARI (aşağıdakı hər bəndi ORİJİNAL şəkillə yoxla — ' +
                      'hər biri orada da varmı, sayı eynidirmi, yeri eynidirmi?):\n' +
                      input.figureClaims +
                      '\n\nOrijinalda olub bu siyahıda OLMAYAN xətt, bucaq və ya işarə varsa, ' +
                      'bu da fərqdir — xüsusən sualın soruşduğu bucağın işarələnməsi.',
                  },
                ]
              : []),
            {
              type: 'text',
              text: 'Fərqləri sadala, sonra qərar ver.',
            },
          ],
        },
      ],
    },
  }
}

export interface Verdict {
  matches: boolean
  confidence: number
  differences: { field: string; severity: 'critical' | 'minor'; note: string }[]
}

/**
 * Read a verdict defensively.
 *
 * A malformed verdict must never read as "matches": the whole wave exists to
 * catch defects, and a parser that defaults to agreement would hide them behind
 * a green tick. Anything unreadable is a non-match with zero confidence, which
 * sends the row to review — the same place a real difference sends it.
 */
export function parseVerdict(raw: unknown): Verdict {
  const value = (raw ?? {}) as Record<string, unknown>
  const differences = readDifferences(value)
  const critical = differences.some((d) => d.severity === 'critical')
  // A difference the model reported and then described with NOTHING is not a
  // small difference, it is an unreadable one — and `minor` is the reading that
  // hides it behind a green tick. Seen live: a recreation that showed the
  // question's own formula twice, because the figure box had swallowed the
  // printed statement, came back as
  // `{ field: 'other', severity: 'minor', note: '' }`. It passed, and the
  // review screen displayed it as verified.
  //
  // It fails the verdict without being promoted to CRITICAL, because those are
  // two different questions. Critical buys another paid read, and a read handed
  // an empty hint is paid to be told the same nothing. This needs a person, and
  // an unverified row is already how it reaches one.
  const undescribed = differences.some((d) => !d.note.trim())
  return {
    // Belt and braces: a model that lists a critical difference and then says
    // it matches has contradicted itself, and the difference is the specific
    // claim while the verdict is the summary.
    matches: value.matches === true && !critical && !undescribed,
    confidence: typeof value.confidence === 'number' ? value.confidence : 0,
    differences,
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

function readDifferences(value: Record<string, unknown>): Verdict['differences'] {
  const fields = Array.isArray(value.difference_fields) ? value.difference_fields : null
  if (fields) {
    const severities = Array.isArray(value.difference_severities)
      ? value.difference_severities
      : []
    const notes = Array.isArray(value.difference_notes) ? value.difference_notes : []
    return fields.map((field, i) => ({
      field: str(field) || 'other',
      // An unlabelled severity is critical, not minor: the arrays came back
      // ragged, so this entry is the one we know least about.
      severity: severities[i] === 'minor' ? ('minor' as const) : ('critical' as const),
      note: str(notes[i]),
    }))
  }

  // The shape the schema used to ask for. Kept so a row verified by an older
  // build still reads, and because the model occasionally volunteers it.
  if (Array.isArray(value.differences)) {
    return (value.differences as Record<string, unknown>[]).map((d) => ({
      field: str(d.field) || 'other',
      severity: d.severity === 'minor' ? ('minor' as const) : ('critical' as const),
      note: str(d.note),
    }))
  }

  // Leaked tool-call markup: `differences` arrived as a string. The text is not
  // worth parsing, but its existence is — the model was describing a difference
  // when it lost the shape. Reported as one critical unknown, which routes the
  // row to a human, rather than discarded into a clean pass.
  const leaked = str(value.differences).trim()
  if (leaked) {
    return [
      {
        field: 'other',
        severity: 'critical',
        note: `[unparsed verdict] ${leaked.slice(0, 400)}`,
      },
    ]
  }
  return []
}

/**
 * What our figure CLAIMS, as a checklist.
 *
 * Two pictures side by side is the right frame for the question as a whole, and
 * a weak one for a single tick among seven lines: the first live run caught
 * every altered digit and every missing option, and missed four of six figure
 * corruptions. Asking "is this claim true of the original?" is a different and
 * much easier task than "spot what changed" — the model no longer has to notice
 * an absence, it has to check a statement.
 *
 * Only the marks and the topology are listed. Coordinates are not claims about
 * the source: the figure is redrawn, not traced, and a reader comparing pixel
 * positions would report a difference on every correct figure.
 */
export function describeFigure(figure: unknown): string | null {
  const items = (figure as { items?: unknown[] } | null)?.items
  if (!Array.isArray(items)) return null
  const geo = items.find(
    (i) => (i as { kind?: string }).kind === 'geometry',
  ) as
    | {
        points?: { id: string; label?: string }[]
        lines?: {
          from: string
          to: string
          kind?: string
          ticks?: number
          parallel?: number
        }[]
        angles?: {
          at: [string, string, string]
          label?: string
          right?: boolean
          arcs?: number
        }[]
      }
    | undefined
  if (!geo) return null

  const lines: string[] = []
  const named = (geo.points ?? []).map((p) => p.label ?? p.id)
  lines.push(`Nöqtələr (${named.length}): ${named.join(', ')}`)

  for (const line of geo.lines ?? []) {
    const marks: string[] = []
    if (line.ticks) marks.push(`${line.ticks} bərabərlik cizgisi`)
    if (line.parallel) marks.push(`${line.parallel} paralellik oxu`)
    const kind =
      line.kind === 'ray' ? 'şüa' : line.kind === 'line' ? 'düz xətt' : 'parça'
    lines.push(
      `${line.from}${line.to}: ${kind}${marks.length ? ` — ${marks.join(', ')}` : ''}`,
    )
  }

  for (const angle of geo.angles ?? []) {
    const marks: string[] = []
    if (angle.right) marks.push('düz bucaq kvadratı')
    if (angle.arcs) marks.push(`${angle.arcs} qövs`)
    if (angle.label) marks.push(`etiket "${angle.label}"`)
    lines.push(
      `∠${angle.at.join('')} (təpə ${angle.at[1]})${marks.length ? ` — ${marks.join(', ')}` : ''}`,
    )
  }

  return lines.join('\n')
}

import type { RecipeCell } from '@/features/exams/api/draft'

export type Difficulty = 1 | 2 | 3
export const DIFFICULTIES: Difficulty[] = [1, 2, 3]

/** Percentages for easy, medium, hard; they must add up to 100. */
export type Mix = Record<Difficulty, number>

export interface RecipeInput {
  /** Topics to draw from, in display order. */
  topics: number[]
  /** Empty slots to fill. */
  remaining: number
  /** Difficulty mix, or null for "whatever the bank has". */
  mix: Mix | null
  /** How many usable questions a topic has at a difficulty (null = any). */
  available: (categoryId: number, difficulty: Difficulty | null) => number
  /** Fill a difficulty the bank has run out of from its neighbour. */
  backfill: boolean
  /**
   * What the section already holds. The mix is a statement about the whole
   * SECTION — "20% hard" of thirty questions is six hard questions, however
   * many were picked by hand first — and topics are balanced counting the
   * questions already there, not only the ones this plan adds.
   */
  existing?: {
    capacity: number
    byTopic: ReadonlyMap<number, number>
    byDifficulty: Readonly<Record<Difficulty, number>>
  }
}

export interface RecipePlan {
  cells: RecipeCell[]
  planned: number
  /** Slots nothing could be found for. */
  shortfall: number
  /** Slots filled at a different difficulty than the mix asked for. */
  substituted: number
}

// Where the next question goes when a difficulty runs dry: the nearest
// other one. Hard falls back to medium before easy, and so on.
const NEIGHBOURS: Record<Difficulty, Difficulty[]> = {
  1: [2, 3],
  2: [1, 3],
  3: [2, 1],
}

/**
 * Turns "N questions over these topics, at this mix" into cells of
 * (topic, difficulty, count) that the bank can actually fill.
 *
 * Planned against what is AVAILABLE, not just against the arithmetic: a plan
 * that asks a topic for three hard questions it does not have comes back
 * short, and the admin learns that only after the draw. Here the shortage is
 * known before the button is pressed, and — if allowed — covered from the
 * neighbouring difficulty rather than left empty.
 *
 * Spreading is greedy, one question at a time to the emptiest topic, so the
 * topics end up within one question of each other — counting the questions
 * the section already holds.
 */
export function planRecipe(input: RecipeInput): RecipePlan {
  const counts = new Map<string, number>()
  const keyOf = (t: number, d: Difficulty | null) => `${t}:${d ?? '*'}`
  const used = (t: number, d: Difficulty | null) => counts.get(keyOf(t, d)) ?? 0
  // Picks at a specific difficulty also spend the "any" pool, and vice versa;
  // the two modes never mix in one plan except through backfill, which only
  // ever plans specific difficulties.
  const capacity = (t: number, d: Difficulty | null) =>
    input.available(t, d) - used(t, d)
  const add = (t: number, d: Difficulty | null) =>
    counts.set(keyOf(t, d), used(t, d) + 1)

  const totalOf = (t: number) => {
    let n = input.existing?.byTopic.get(t) ?? 0
    for (const [key, count] of counts) if (key.startsWith(`${t}:`)) n += count
    return n
  }

  // One question at a time to the topic with the FEWEST questions so far —
  // counting what the section already holds and what this plan has given it
  // at every difficulty — with the most room left breaking ties. Handing out
  // one per topic per round instead gave a topic filled by hand the same
  // share as an empty one, and ordering by this difficulty's room alone gave
  // each difficulty's spare questions to the same leading topics.
  const spread = (count: number, d: Difficulty | null): number => {
    let left = count
    while (left > 0) {
      let best: number | null = null
      for (const t of input.topics) {
        if (capacity(t, d) <= 0) continue
        if (
          best === null ||
          totalOf(t) < totalOf(best) ||
          (totalOf(t) === totalOf(best) && capacity(t, d) > capacity(best, d))
        ) {
          best = t
        }
      }
      if (best === null) break
      add(best, d)
      left -= 1
    }
    return left
  }

  let shortfall = 0
  let substituted = 0

  if (!input.mix || !input.topics.length) {
    shortfall = input.topics.length
      ? spread(input.remaining, null)
      : input.remaining
  } else {
    const targets = difficultyTargets(
      input.remaining,
      input.mix,
      input.existing,
    )
    // Hardest first: it is the scarcest, and it should get first call on the
    // topics that have any.
    for (const d of [3, 2, 1] as Difficulty[]) {
      let left = spread(targets[d], d)
      if (left > 0 && input.backfill) {
        for (const n of NEIGHBOURS[d]) {
          const before = left
          left = spread(left, n)
          substituted += before - left
          if (left === 0) break
        }
      }
      shortfall += left
    }
  }

  const cells: RecipeCell[] = []
  for (const [key, count] of counts) {
    const [t, d] = key.split(':')
    cells.push({
      category_id: Number(t),
      difficulty: d === '*' ? null : Number(d),
      count,
    })
  }
  return {
    cells,
    planned: input.remaining - shortfall,
    shortfall,
    substituted,
  }
}

/**
 * How many of each difficulty the remaining slots should hold so that the
 * WHOLE section lands on the mix. A difficulty the hand-picked questions
 * already over-fill gets none; whatever is left over after that is spread by
 * the mix again, so the targets always add up to `remaining`.
 */
export function difficultyTargets(
  remaining: number,
  mix: Mix,
  existing?: RecipeInput['existing'],
): Record<Difficulty, number> {
  if (!existing) return apportion(remaining, mix)
  const whole = apportion(existing.capacity, mix)
  const out = { 1: 0, 2: 0, 3: 0 } as Record<Difficulty, number>
  let given = 0
  for (const d of DIFFICULTIES) {
    out[d] = Math.max(0, whole[d] - (existing.byDifficulty[d] ?? 0))
    given += out[d]
  }
  if (given > remaining) {
    // Cannot happen with a consistent capacity, but never plan more than the
    // empty slots: scale down along the same proportions.
    return apportion(remaining, out)
  }
  if (given < remaining) {
    const extra = apportion(remaining - given, mix)
    for (const d of DIFFICULTIES) out[d] += extra[d]
  }
  return out
}

/** Largest-remainder rounding: the parts always add up to `total`. */
export function apportion(total: number, mix: Mix): Record<Difficulty, number> {
  const sum = DIFFICULTIES.reduce((s, d) => s + mix[d], 0) || 1
  const raw = DIFFICULTIES.map((d) => ({ d, exact: (total * mix[d]) / sum }))
  const out = { 1: 0, 2: 0, 3: 0 } as Record<Difficulty, number>
  let given = 0
  for (const r of raw) {
    out[r.d] = Math.floor(r.exact)
    given += out[r.d]
  }
  const byRemainder = [...raw].sort(
    (a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)),
  )
  for (let i = 0; given < total && i < byRemainder.length; i += 1) {
    out[byRemainder[i]!.d] += 1
    given += 1
  }
  return out
}

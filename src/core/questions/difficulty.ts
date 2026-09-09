// The difficulty scale, named once.
//
// Three levels, stored as 1..3 and shown as words. The number is what the
// model returns, the database checks and the filter matches; the word is what a
// person reads. Both screens that show a difficulty and the one that asks for
// it draw from this file, so the scale cannot drift between them — and a fourth
// level, should one ever be wanted, is one edit here plus the migration that
// widens the check.
//
// In core rather than a feature because the worker's row payload and the
// extraction schema speak the same scale, and an eval pins the schema to it.

export const DIFFICULTY_LEVELS = [1, 2, 3] as const

export type Difficulty = (typeof DIFFICULTY_LEVELS)[number]

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  1: 'asan',
  2: 'orta',
  3: 'çətin',
}

export function isDifficulty(value: unknown): value is Difficulty {
  return (DIFFICULTY_LEVELS as readonly number[]).includes(value as number)
}

/** The word for a stored level, or a dash for a row that has none yet. */
export function difficultyLabel(value: number | null | undefined): string {
  return isDifficulty(value) ? DIFFICULTY_LABEL[value] : '—'
}

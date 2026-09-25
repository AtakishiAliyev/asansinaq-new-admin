/** "100 dəq" — exam lengths are whole minutes in every program seen so far. */
export function minutesLabel(seconds: number): string {
  const m = Math.round(seconds / 60)
  return `${m} dəq`
}

/** Scores keep two decimals at most and drop trailing zeros: 500, 157,5, 4,75. */
export function scoreLabel(value: number): string {
  return new Intl.NumberFormat('az-AZ', { maximumFractionDigits: 2 }).format(
    value,
  )
}

/** "4 səhv 1 düzü aparır" from a penalty ratio of 0.25. */
export function penaltyLabel(ratio: number): string {
  if (ratio <= 0) return 'cərimə yoxdur'
  const wrong = 1 / ratio
  return Number.isInteger(wrong)
    ? `${wrong} səhv 1 düzü aparır`
    : `hər səhv −${scoreLabel(ratio)} düz`
}

export function dateLabel(iso: string): string {
  const d = new Date(iso)
  const months = [
    'yan',
    'fev',
    'mar',
    'apr',
    'may',
    'iyn',
    'iyl',
    'avq',
    'sen',
    'okt',
    'noy',
    'dek',
  ]
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

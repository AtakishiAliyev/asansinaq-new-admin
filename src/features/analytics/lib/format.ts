// Formatters shared by every analytics screen, so a percentage, a count
// and a duration read the same on the dashboard, in a viewer and on a page.
export function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : `${Math.round(v)}%`
}

export function num(v: number | null | undefined, digits = 0): string {
  return v === null || v === undefined
    ? '—'
    : new Intl.NumberFormat('az-AZ', { maximumFractionDigits: digits }).format(
        v,
      )
}

export function seconds(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—'
  const m = Math.floor(v / 60)
  const s = Math.round(v % 60)
  return m ? `${m} dəq ${s} san` : `${s} san`
}

// Editing a geometry figure, as pure functions over the spec.
//
// In core rather than beside the dialog, and free of React, for the reason the
// rest of the pipeline is: the operations have to be assertable offline. An
// editor is the one place a figure can be silently destroyed — a delete that
// leaves a line pointing at a removed point renders as nothing and lints as an
// empty figure — and "we clicked around and it looked fine" is not a check that
// survives the next change.
//
// Every function returns a NEW spec. Nothing mutates, so undo is a stack of
// values and the live preview never sees a half-applied edit.
import type { GeoAngle, GeoLine, GeometryFig, GeoPoint } from '@/core/figures/figspec'

/** The next free single-letter id, falling back to A1, A2… once A–Z is used. */
export function nextPointId(fig: GeometryFig): string {
  const taken = new Set(fig.points.map((p) => p.id))
  for (let i = 0; i < 26; i++) {
    const id = String.fromCharCode(65 + i)
    if (!taken.has(id)) return id
  }
  for (let n = 1; ; n++) {
    const id = `A${n}`
    if (!taken.has(id)) return id
  }
}

export function addPoint(fig: GeometryFig, x: number, y: number): GeometryFig {
  const id = nextPointId(fig)
  return {
    ...fig,
    points: [...fig.points, { id, x: Math.round(x), y: Math.round(y), label: id, dot: true }],
  }
}

export function movePoint(fig: GeometryFig, id: string, x: number, y: number): GeometryFig {
  return {
    ...fig,
    points: fig.points.map((p) =>
      p.id === id ? { ...p, x: Math.round(x), y: Math.round(y) } : p,
    ),
  }
}

export function updatePoint(
  fig: GeometryFig,
  id: string,
  patch: Partial<Omit<GeoPoint, 'id'>>,
): GeometryFig {
  return {
    ...fig,
    points: fig.points.map((p) => (p.id === id ? { ...p, ...patch } : p)),
  }
}

/**
 * Removes a point AND everything that referred to it.
 *
 * The cascade is the whole reason this is a function rather than a filter at
 * the call site. A line whose endpoint no longer exists is skipped by the
 * renderer and counted by the lint, so a figure that lost one point quietly
 * loses two edges as well — visible only as a drawing that is subtly wrong.
 */
export function removePoint(fig: GeometryFig, id: string): GeometryFig {
  return {
    ...fig,
    points: fig.points.filter((p) => p.id !== id),
    lines: fig.lines.filter((l) => l.from !== id && l.to !== id),
    angles: (fig.angles ?? []).filter((a) => !a.at.includes(id)),
    ...(fig.regions
      ? { regions: fig.regions.filter((r) => !r.points.includes(id)) }
      : {}),
  }
}

/** Both directions count as the same edge: AB and BA are one line. */
export const sameEdge = (line: GeoLine, from: string, to: string): boolean =>
  (line.from === from && line.to === to) || (line.from === to && line.to === from)

export function addLine(fig: GeometryFig, from: string, to: string): GeometryFig {
  if (from === to) return fig
  if (fig.lines.some((l) => sameEdge(l, from, to))) return fig
  if (!fig.points.some((p) => p.id === from) || !fig.points.some((p) => p.id === to)) return fig
  return { ...fig, lines: [...fig.lines, { from, to }] }
}

export function removeLine(fig: GeometryFig, index: number): GeometryFig {
  return { ...fig, lines: fig.lines.filter((_, i) => i !== index) }
}

export function updateLine(fig: GeometryFig, index: number, patch: Partial<GeoLine>): GeometryFig {
  return {
    ...fig,
    lines: fig.lines.map((l, i) => {
      if (i !== index) return l
      const next = { ...l, ...patch }
      // Length marks are meaningless on something with no length, and the lint
      // says so. Dropping them here means toggling a segment to a ray cannot
      // leave a flag behind that the reviewer did not cause.
      if (next.kind && next.kind !== 'segment') delete next.ticks
      return prune(next)
    }),
  }
}

export function addAngle(fig: GeometryFig, at: [string, string, string]): GeometryFig {
  const known = new Set(fig.points.map((p) => p.id))
  if (at.some((id) => !known.has(id))) return fig
  if (at[0] === at[1] || at[1] === at[2] || at[0] === at[2]) return fig
  const exists = (fig.angles ?? []).some(
    (a) => a.at[1] === at[1] && ((a.at[0] === at[0] && a.at[2] === at[2]) || (a.at[0] === at[2] && a.at[2] === at[0])),
  )
  if (exists) return fig
  return { ...fig, angles: [...(fig.angles ?? []), { at }] }
}

export function removeAngle(fig: GeometryFig, index: number): GeometryFig {
  return { ...fig, angles: (fig.angles ?? []).filter((_, i) => i !== index) }
}

export function updateAngle(
  fig: GeometryFig,
  index: number,
  patch: Partial<GeoAngle>,
): GeometryFig {
  return {
    ...fig,
    angles: (fig.angles ?? []).map((a, i) => {
      if (i !== index) return a
      const next = { ...a, ...patch }
      // A right angle is drawn as a square, not as arcs. Holding both is the
      // contradiction `geo_right_angle_with_arcs` exists to catch, so the
      // editor cannot produce it in the first place.
      if (next.right) delete next.arcs
      return prune(next)
    }),
  }
}

/** Drops keys set to undefined or zero so the saved spec has no dead fields. */
function prune<T extends Record<string, unknown>>(value: T): T {
  const out = { ...value }
  for (const key of Object.keys(out)) {
    const v = out[key]
    if (v === undefined || v === null || v === 0 || v === false || v === '') delete out[key]
  }
  return out
}

/**
 * A count that cycles rather than a number field.
 *
 * Marks are 1–3 and mean "these are equal to each other", so the useful gesture
 * is stepping to the next group, not typing a value. Zero is off.
 */
export function cycleMark(current: number | undefined): 1 | 2 | 3 | undefined {
  const next = ((current ?? 0) + 1) % 4
  return next === 0 ? undefined : (next as 1 | 2 | 3)
}

/** Which point ids the figure would be left referring to but not defining. */
export function danglingRefs(fig: GeometryFig): string[] {
  const known = new Set(fig.points.map((p) => p.id))
  const missing = new Set<string>()
  for (const line of fig.lines) {
    if (!known.has(line.from)) missing.add(line.from)
    if (!known.has(line.to)) missing.add(line.to)
  }
  for (const angle of fig.angles ?? []) {
    for (const id of angle.at) if (!known.has(id)) missing.add(id)
  }
  return [...missing].sort()
}

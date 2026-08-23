// What the question text says the figure must show.
//
// Turkish geometry banks name their objects in the prose, in a notation that is
// completely regular: `m(\widehat{BAF})` is the angle at vertex A, `[BE]` is a
// segment, `[AF` with one bracket is a ray. That regularity is worth something
// — it means "does the figure actually contain what the question asks about?"
// is a deterministic check, answerable with no model call and no rendering.
//
// It exists because of a real row: a question asking for m(CDE) whose figure
// declared five angles, none of them at D. Everything about that row looked
// healthy — a geometry figure, correct topology, marks present, no lint errors
// — and the one thing the reader needs was absent.

/** `XYZ` where Y is the vertex. */
export interface AngleRef {
  arms: [string, string]
  vertex: string
  /** As written, for the message. */
  text: string
}

/** A segment or ray the text names: the two points must be joined. */
export interface EdgeRef {
  a: string
  b: string
  text: string
}

export interface FigureRefs {
  angles: AngleRef[]
  edges: EdgeRef[]
}

// Point names in these books are single capitals. Restricting to that is what
// keeps the parser from reading ordinary prose as geometry — `m(3x)` is not an
// angle, and neither is a bracketed citation.
const NAME = '[A-Z]'

const ANGLE_PATTERNS = [
  // m(\widehat{BAF}), m(\hat{BAF}), m(BAF), m(\angle BAF)
  new RegExp(
    `m\\s*\\(\\s*(?:\\\\widehat|\\\\hat|\\\\angle)?\\s*\\{?\\s*(${NAME})\\s*(${NAME})\\s*(${NAME})\\s*\\}?\\s*\\)`,
    'g',
  ),
  // \angle BAF or ∠BAF, standing alone
  new RegExp(`(?:\\\\angle|∠)\\s*\\{?\\s*(${NAME})\\s*(${NAME})\\s*(${NAME})\\s*\\}?`, 'g'),
]

const EDGE_PATTERNS = [
  // [BE] — segment. Also [BE| and |BE], which appear in these books.
  new RegExp(`[[|]\\s*(${NAME})\\s*(${NAME})\\s*[\\]|]`, 'g'),
  // [AF with no closing bracket — a ray. The lookahead keeps it from eating
  // the opening half of a segment.
  new RegExp(`\\[\\s*(${NAME})\\s*(${NAME})\\s*(?![\\]|])`, 'g'),
]

/**
 * Everything the text names, deduplicated.
 *
 * Deliberately forgiving about what it does NOT match: a reference this misses
 * costs a check, while one it invents costs a false flag on a correct row, and
 * a lint that cries wolf gets ignored.
 */
export function figureRefs(text: string): FigureRefs {
  const angles = new Map<string, AngleRef>()
  const edges = new Map<string, EdgeRef>()

  for (const pattern of ANGLE_PATTERNS) {
    for (const m of text.matchAll(pattern)) {
      const [x, y, z] = [m[1]!, m[2]!, m[3]!]
      // A "vertex" repeated in its own arms is not an angle.
      if (x === y || z === y) continue
      angles.set(`${x}${y}${z}`, { arms: [x, z], vertex: y, text: `${x}${y}${z}` })
    }
  }

  for (const pattern of EDGE_PATTERNS) {
    for (const m of text.matchAll(pattern)) {
      const [a, b] = [m[1]!, m[2]!]
      if (a === b) continue
      // Undirected: [AB] and [BA] are the same edge.
      const key = [a, b].sort().join('')
      if (!edges.has(key)) edges.set(key, { a, b, text: `${a}${b}` })
    }
  }

  return { angles: [...angles.values()], edges: [...edges.values()] }
}

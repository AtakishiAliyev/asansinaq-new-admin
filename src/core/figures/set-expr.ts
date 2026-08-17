// Parser for set-algebra expressions used by Venn / shaded-region figures.
// Accepts the notation the book uses plus ASCII aliases:
//   intersection: ∩  &  *
//   union:        ∪  |  +
//   difference:   −  -  \  ∖
//   complement:   '  (postfix, also unicode ′)
// Sets are single upper/lower-case letters (A, B, C, E, ...).

export type SetAst =
  | { t: 'set'; id: string }
  | { t: 'compl'; a: SetAst }
  | { t: 'inter'; a: SetAst; b: SetAst }
  | { t: 'union'; a: SetAst; b: SetAst }
  | { t: 'diff'; a: SetAst; b: SetAst }

type Tok =
  | { k: 'set'; id: string }
  | { k: 'op'; op: '∩' | '∪' | '−' }
  | { k: 'compl' }
  | { k: 'lp' }
  | { k: 'rp' }

// Models sometimes emit LaTeX notation inside exprs despite instructions —
// normalize it to the symbolic form before tokenizing.
function normalizeLatexOps(input: string): string {
  return input
    .replace(/\\cap\b/g, '∩')
    .replace(/\\cup\b/g, '∪')
    .replace(/\\setminus\b|\\smallsetminus\b|\\backslash\b/g, '−')
    .replace(/\\prime\b/g, "'")
    .replace(/\\left|\\right/g, '')
    .replace(/\^\s*\{?\s*c\s*\}?/g, "'") // A^c complement notation
}

function tokenize(input: string): Tok[] {
  const s = normalizeLatexOps(input)
  const toks: Tok[] = []
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (ch === ' ' || ch === '\t' || ch === '\n') {
      i++
      continue
    }
    // Set ids may be multi-letter (Roman-numeral sets: I, II, III, IV; or K, L, M).
    if (/[A-Za-z]/.test(ch)) {
      let j = i
      while (j < s.length && /[A-Za-z]/.test(s[j])) j++
      toks.push({ k: 'set', id: s.slice(i, j) })
      i = j
      continue
    }
    if (ch === '∩' || ch === '&' || ch === '*') toks.push({ k: 'op', op: '∩' })
    else if (ch === '∪' || ch === '|' || ch === '+') toks.push({ k: 'op', op: '∪' })
    else if (ch === '−' || ch === '-' || ch === '\\' || ch === '∖') toks.push({ k: 'op', op: '−' })
    else if (ch === "'" || ch === '′' || ch === '`') toks.push({ k: 'compl' })
    else if (ch === '(' || ch === '{' || ch === '[') toks.push({ k: 'lp' })
    else if (ch === ')' || ch === '}' || ch === ']') toks.push({ k: 'rp' })
    else throw new Error(`Naməlum simvol çoxluq ifadəsində: "${ch}"`)
    i++
  }
  return toks
}

// Grammar (complement tightest, then intersection, then union/difference L-to-R):
//   expr   = term ( (∪|−) term )*
//   term   = factor ( ∩ factor )*
//   factor = atom "'"*
//   atom   = set | "(" expr ")"
export function parseSetExpr(input: string): SetAst {
  const toks = tokenize(input)
  let i = 0
  const peek = () => toks[i]
  const next = () => toks[i++]

  function parseExpr(): SetAst {
    let left = parseTerm()
    while (peek() && peek().k === 'op' && (peek() as { op: string }).op !== '∩') {
      const op = (next() as { op: '∪' | '−' }).op
      const right = parseTerm()
      left = op === '∪' ? { t: 'union', a: left, b: right } : { t: 'diff', a: left, b: right }
    }
    return left
  }

  function parseTerm(): SetAst {
    let left = parseFactor()
    while (peek() && peek().k === 'op' && (peek() as { op: string }).op === '∩') {
      next()
      const right = parseFactor()
      left = { t: 'inter', a: left, b: right }
    }
    return left
  }

  function parseFactor(): SetAst {
    let node = parseAtom()
    while (peek() && peek().k === 'compl') {
      next()
      node = { t: 'compl', a: node }
    }
    return node
  }

  function parseAtom(): SetAst {
    const tok = peek()
    if (!tok) throw new Error('Çoxluq ifadəsi yarımçıqdır')
    if (tok.k === 'set') {
      next()
      return { t: 'set', id: tok.id }
    }
    if (tok.k === 'lp') {
      next()
      const inner = parseExpr()
      if (!peek() || peek().k !== 'rp') throw new Error('Bağlanmayan mötərizə')
      next()
      return inner
    }
    throw new Error(`Gözlənilməz token: ${JSON.stringify(tok)}`)
  }

  const result = parseExpr()
  if (i !== toks.length) throw new Error('Çoxluq ifadəsində artıq simvollar var')
  return result
}

// Collect the set ids referenced, for validation against declared shapes.
export function setIdsUsed(ast: SetAst, acc = new Set<string>()): Set<string> {
  switch (ast.t) {
    case 'set':
      acc.add(ast.id)
      break
    case 'compl':
      setIdsUsed(ast.a, acc)
      break
    default:
      setIdsUsed(ast.a, acc)
      setIdsUsed(ast.b, acc)
  }
  return acc
}

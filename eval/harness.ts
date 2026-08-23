// A test runner small enough to read in one sitting. The project ships no test
// framework, and the pipeline core is the one place CLAUDE.md says must not
// change unchecked — so the harness is a dependency-free file rather than an
// argument about which framework to adopt.

// A case may be async. Spelling that out matters: `() => void` also accepts an
// async function, so a runner that forgets to await one still typechecks and
// still reports it green — the assertion inside simply never runs.
export type Check = () => void | Promise<void>

export interface Suite {
  name: string
  cases: { name: string; fn: Check }[]
}

export function suite(name: string, cases: Record<string, Check>): Suite {
  return {
    name,
    cases: Object.entries(cases).map(([caseName, fn]) => ({
      name: caseName,
      fn,
    })),
  }
}

function show(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value)
  return JSON.stringify(value) ?? String(value)
}

export function eq<T>(actual: T, expected: T, what = 'nəticə'): void {
  if (!Object.is(actual, expected)) {
    throw new Error(`${what}: gözlənilən ${show(expected)}, alınan ${show(actual)}`)
  }
}

export function deepEq(actual: unknown, expected: unknown, what = 'nəticə'): void {
  const a = show(actual)
  const b = show(expected)
  if (a !== b) throw new Error(`${what}: gözlənilən ${b}, alınan ${a}`)
}

export function ok(value: unknown, what = 'şərt'): void {
  if (!value) throw new Error(`${what}: doğru gözlənilirdi, alınan ${show(value)}`)
}

export function notOk(value: unknown, what = 'şərt'): void {
  if (value) throw new Error(`${what}: yanlış gözlənilirdi, alınan ${show(value)}`)
}

// Resolves the app's `@/…` alias for plain Node. Node strips the types itself
// — the project's `erasableSyntaxOnly` guarantees every source file is
// strippable — so the harness runs the REAL core modules with no bundler, no
// test framework and no extra dependency.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SRC = new URL('../src/', import.meta.url)

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const base = new URL(specifier.slice(2), SRC).href
    for (const suffix of ['', '.ts', '.tsx', '/index.ts']) {
      if (existsSync(fileURLToPath(base + suffix))) {
        return nextResolve(base + suffix, context)
      }
    }
  }
  return nextResolve(specifier, context)
}

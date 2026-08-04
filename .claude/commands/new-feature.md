---
description: Scaffold a new feature module under src/features/ per CLAUDE.md
argument-hint: <feature-name-in-kebab-case>
---

Scaffold a new feature module named `$ARGUMENTS` following the structure and
conventions in CLAUDE.md:

1. Create `src/features/$ARGUMENTS/` with:
   - `api/keys.ts` — query key factory named `<featureCamelCase>Keys`
     following the exact pattern from the "TanStack Query conventions" section
   - `components/` (empty, with a `.gitkeep`)
   - `schemas.ts` — empty Zod schema file with imports ready
   - `types.ts` — types inferred from schemas (start empty)
   - `index.ts` — the feature's public API (export only what other
     features may use)
2. Do NOT create routes, hooks, or UI yet unless I asked for them in the
   same message.
3. Run `npm run typecheck`.
4. Report the created files as a tree and stop for my next instruction.

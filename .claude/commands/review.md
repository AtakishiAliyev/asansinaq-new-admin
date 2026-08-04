---
description: Review uncommitted changes against project conventions
---

Review the current uncommitted changes (`git diff` + `git diff --staged`)
against the rules in CLAUDE.md. Check specifically:

- State placement: server data in Query, client state in Zustand, UI state local
- No direct supabase/axios/fetch calls in components
- Zod parsing at every boundary; types via z.infer, not hand-written
- Query keys come from the feature's key factory; correct invalidation
- Error handling follows the errors.ts normalizer pattern
- No `any`; no editing of generated `database.ts`
- File naming (kebab-case), `@/` imports, cross-feature imports via index.ts
- No business logic inside `src/components/ui/`
- No secrets or env values in code

Output a table: file | rule violated | suggested fix. Then a short verdict.
Do NOT fix anything yet — report first and wait for my decision.

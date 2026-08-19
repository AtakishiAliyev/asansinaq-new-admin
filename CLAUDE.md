# Asansinaq - Admin — Frontend

## Project overview

Admin panel for Asansinaq — a platform where students take practice exams
(sınaqlar). This app is the internal/staff side; no student-facing UI here.
Core flow: admins upload PDF or scanned exam papers → the system crops and
extracts questions → AI recreates each question as a clean structured entry
(category/subcategory, difficulty, correct answer, optional image). Admins
review the extracted questions, then assemble exams from the question bank.
Also: user management, credits, and general operations. Fresh build,
no legacy code.

## Where work runs

There is no separate backend service. The split is by what each stage needs:

- **Segmentation and cropping** run in the browser, in a Web Worker (pdf.js +
  canvas). Deterministic, no secrets, no per-page cost.
- **Every AI model call** goes through a Supabase Edge Function
  (`question-ops`, one function with an `op` discriminator) — page detection
  included. Model API keys live in function secrets and never reach the client
  bundle, and one door is also what keeps the budget cap, the ledger and the
  cache impossible to bypass by adding a second function.
- **Orchestration stays in the browser** and is deliberate, not temporary: the
  vector figure must be rendered before it can be compared with the original,
  and crops are read through the operator's own session. The function only
  runs models; every decision (lint, repair, lane routing, verification) lives
  client-side where the renderers are.
- **The work list lives in the database.** `questions.queued_at` marks work to
  do and `claimed_at`/`claimed_by` is a lease, so a closed tab loses at most
  the batch in flight and a second tab adds throughput instead of duplicating
  spend. Claims go through `claim_questions()` (`for update skip locked`); a
  worker renews its lease (`renew_claims`) while a batch runs, and handing work
  back (`release_questions`) returns the attempt — only a worker that never
  came back spends one.
- Pipeline logic (segmentation, the figure DSL, lint/verify, answer-key
  parsing) is written as pure, runtime-agnostic modules — no DOM, no
  `import.meta.env` — so the same code runs in the browser, in a function, and
  in Node for evals.

The sibling `exam/` folder is a throwaway MVP kept as reference for its
algorithms only. Its architecture — API keys in the browser, anon-writable
tables — is deliberately not carried over.

## Stack

- React + TypeScript (strict) + Vite
- React Router (SPA)
- TanStack Query (server state) + Zustand (client state)
- React Hook Form + Zod (forms & validation)
- Tailwind CSS + shadcn/ui (`src/components/ui/`)
- Supabase (`@supabase/supabase-js`) — DB, Auth, Storage, Edge Functions
- Axios — external (non-Supabase) APIs only
- Deploy: Vercel

## Commands

- `npm run dev` — dev server
- `npm run eval` — pipeline-core regression suite (free, offline; see `eval/README.md`)
- `npm run typecheck` — TS check (a hook runs this automatically after edits)
- `npm run lint` / `npm run lint:fix` — oxlint
- `npm run format` — Prettier write
- `npm run build` — typecheck + production build
- `npm run types:gen` — regenerate `src/types/database.ts` from Supabase schema
- `npx supabase migration new <name>` — start a migration in `supabase/migrations/`
- `npx supabase db push` — apply pending migrations to the linked project
- `npm run config:push` — apply `supabase/config.toml` to the linked project.
  Needs the `.env` values loaded (`set -a; . ./.env; set +a`) and refuses to
  push loopback auth URLs, which would repoint production sign-in at a laptop.
  Never call `npx supabase config push` directly — that is the unguarded path.

## Spending money

Model calls cost real money and the question bank is measured in thousands of
questions, so cost is a first-class concern, not an afterthought.

- Nothing paid runs automatically. Crops are saved for free; structuring is
  always an explicit operator action with a cost estimate first.
- Every call is logged to `ops_log` (tokens, ms, estimated cost) and cached in
  `ops_cache` keyed by a hash that includes the prompt version and the
  resolved model — an unchanged re-run is nearly free.
- A daily budget cap (`DAILY_BUDGET_USD`, checked via `ops_spend_today()`)
  refuses new spend server-side. The client treats that refusal as a stop, not
  as a per-question failure.
- All calls pass through one shared rate gate (`lib/rate-gate.ts`): a provider
  429 backs every caller off together and lowers the ceiling, because a 429
  wastes the paid steps a question already completed.
- `stores/pipeline-store.ts` holds the operator's speed/cost knobs. Every
  default reproduces the careful behaviour; each knob's UI names the risk it
  trades away, not just the saving.

## Hallucination defences

The recreation must copy the source, never improve it. Four independent
layers, none of which the system may self-certify:

1. Temperature 0, copy-only prompt rules, and the PDF text layer as a hint.
2. Deterministic lint (`core/questions/lint.ts`) over the structured result.
3. A second, hint-free read compared against the first — agreement is what
   earns `verified`. On scans (no hint to withhold) the model class is swapped
   instead, or the two reads would be the same call.
4. Generated figures and image options are rendered and compared against the
   original region they came from.

Anything that fails a layer lands in the Diqqət queue with a flag. Auto-approve
(off by default) only ever passes questions that cleared all four.

## Source of truth

Supabase is the source of truth. This file may be outdated; the schema is not.

- **DB shapes** → generated types in `src/types/database.ts` (`npm run types:gen`).
  Never handwrite row types. Never edit the generated file.
- **Access rules** → RLS policies. The client is untrusted: client-side checks
  are UX, never security.
- Before implementing a feature that touches a table: inspect its actual schema
  and RLS (via Supabase MCP). Do not infer column names or relationships.
- After any schema change: run `npm run types:gen`, then fix resulting type errors.
- If the schema contradicts this file, the schema wins — flag the mismatch.

## Auth

- Email OTP only — a six-digit code, no passwords. Signup is disabled; admins
  are provisioned through the Auth admin API, never self-created.
- Access is an email allowlist, not roles. `public.admin_emails` holds the
  addresses and `public.is_admin()` is the single predicate **every** RLS policy
  resolves through, so removing a row revokes access on the next request rather
  than when the session expires.
- The allowlist is data, so it lives in `supabase/seed.sql`, never in a
  migration. Seeds do not run on `db push`: a new hosted project needs that row
  inserted once by hand, or nobody can get in.
- The client's `is_admin` call only decides which screen to render. RLS is the
  boundary: a signed-in non-admin must see no data regardless of the UI.
- Supabase Auth via `supabase-js`. The client manages session and refresh —
  never store or refresh tokens manually.
- Auth state is exposed through a single `use-auth` hook backed by
  `onAuthStateChange`. Components read from it, never from `supabase.auth` directly.
- Route protection lives in the router layer (a protected layout route),
  not scattered per-component.

## State management

- **Server state**: anything from Supabase or external APIs → TanStack Query.
  Every call goes through a query/mutation hook in `src/features/<feature>/api/`.
  Components never import the supabase client or axios directly.
- **Client state**: Zustand. Stores in `src/stores/`, one store per concern.
  Persist only what must survive reload.
- **Local UI state**: useState/useReducer. Modal-open booleans and hover
  states never go into Zustand.
- Server data never lives in Zustand. It lives in the Query cache.

## TanStack Query conventions

- **Query keys**: per-feature key factory in `src/features/<feature>/api/keys.ts`:
  ```ts
  export const productKeys = {
    all: ["products"] as const,
    lists: () => [...productKeys.all, "list"] as const,
    list: (filters: ProductFilters) =>
      [...productKeys.lists(), filters] as const,
    detail: (id: string) => [...productKeys.all, "detail", id] as const,
  };
  ```
  No inline array keys in components or hooks.
- **Invalidation**: mutations invalidate the narrowest sufficient key in
  `onSuccess` (e.g. `lists()` after create, `detail(id)` + `lists()` after update).
- **Defaults**: `staleTime: 60_000` set globally on the QueryClient;
  override per-query only with a reason.
- **Parsing**: every fetch function parses the response with the feature's
  Zod schema before returning. Types come from `z.infer`, not hand-written.

## Error handling

- `src/lib/errors.ts` exports a normalizer: PostgrestError / AuthError /
  AxiosError / ZodError → `AppError { code, message, cause }`.
- **Queries**: render an inline error state (early return in the component).
- **Mutations**: toast (sonner) with the normalized message.
- **Routes**: React Router `errorElement` per route branch as the boundary.
- Never show raw server error messages to users. Never swallow errors silently.

## File structure

```
supabase/
├── config.toml             # the project's settings — pushed, not just local
├── seed.sql                # data, not schema — e.g. the admin allowlist
├── templates/              # auth email bodies, referenced from config.toml
└── migrations/             # the schema and RLS — committed, never ad-hoc SQL
eval/                       # core regression suites — `npm run eval`, no deps
src/
├── app/                    # routing, providers, root setup
│   ├── providers.tsx       # QueryClient, auth bootstrap, toaster
│   ├── router.tsx
│   ├── protected-layout.tsx # the one route guard
│   └── App.tsx
├── core/                   # pure pipeline logic: no DOM, no env, no React.
│   │                       # Shared by the app, Edge Functions, and evals.
│   ├── segment/            # column/question detection from the text layer
│   ├── extract/            # prompts, wire schemas, request builders
│   ├── figures/            # the figure DSL (FigSpec) and its evaluators
│   ├── questions/          # lint, compare, wire→question normalisation
│   └── answer-key/         # deterministic key-table parsing and matching
├── features/
│   └── <feature-name>/
│       ├── api/            # query/mutation hooks + keys.ts
│       ├── components/     # feature-specific components
│       ├── hooks/          # feature-specific hooks
│       ├── schemas.ts      # Zod schemas
│       ├── types.ts
│       └── index.ts        # public API (only entry for other features)
├── components/
│   ├── ui/                 # shadcn primitives — NO business logic
│   └── layout/             # Header, Sidebar, Shell
├── hooks/                  # cross-feature hooks
├── lib/
│   ├── supabase.ts         # supabase client (created once, exported)
│   ├── api-client.ts       # axios instance for external APIs
│   ├── errors.ts           # error normalizer
│   ├── env.ts              # Zod-validated import.meta.env
│   └── utils.ts
├── stores/                 # Zustand stores
├── types/
│   └── database.ts         # GENERATED — never edit by hand
└── index.css               # Tailwind v4 theme tokens live here
```

Decision rules:

- Used in 1 feature only → `features/<name>/`
- Used across features → `components/`, `hooks/`, or `lib/`
- Pure presentation, no logic → `components/ui/`
- Has business logic → `features/<name>/components/`
- Must also run outside the browser → `core/` (then it may not import React,
  `@/lib/supabase`, or `import.meta.env`)

## Naming

- **Files**: kebab-case — `generation-card.tsx`, `use-auth.ts`, `format-date.ts`
- Booleans: `is/has/can/should` prefix
- Event handlers: `handleX` inside the component, `onX` as a prop
- Hooks: `use` prefix; constants: SCREAMING_SNAKE_CASE

## Patterns we follow

- **Zod schemas as the single source of truth for shapes** — types via
  `z.infer`, applied at every boundary (API responses, forms, env, URL params).
- **Early returns for guards**: loading/error/empty at the top, happy path
  below. No deeply nested ternaries in JSX.
- **Discriminated unions over boolean flags** for multi-state logic.
- **Composition over prop explosion**: `<Card><Card.Header/></Card>` over
  one component with 15 props.
- **Custom hooks for hard-to-read logic**: >~20 lines of state/effect logic
  in a component → extract into a `use-x` hook.

## Security

- Only `VITE_`-prefixed env vars reach the client. All of them are validated
  in `src/lib/env.ts` with Zod — fail fast on missing vars.
- The Supabase anon key is public by design. The `service_role` key must
  NEVER appear anywhere in this repo. Not in code, not in `.env`, nowhere.
- Model API keys (Gemini, OpenAI) belong in Edge Function secrets. A model key
  behind a `VITE_` prefix is a published key.
- `supabase/config.toml` is the source of truth for project settings, including
  auth. Change a setting there and run `config push` — never in the dashboard,
  or the repo and the project drift apart silently (it has happened twice).
- Three auth settings are load-bearing for `is_admin()`. In `config.toml` they
  read `[auth] enable_signup = false`, `[auth.email] enable_confirmations = true`
  and `double_confirm_changes = true`. Do not relax one without re-auditing that
  function.
- `[auth.email] enable_signup` is **not** a signup policy — it is the email
  provider switch. Setting it false disables logins entirely ("Email logins are
  disabled"). It must stay `true`; new accounts are blocked by `[auth]
  enable_signup = false` one level up.
- Every table has RLS enabled. If a query fails with a permission error,
  the fix is a policy change — never a client-side workaround.
- Validate all external input (forms, URL params, API responses) with Zod.

## Workflow

- Before any non-trivial feature: state the plan (files to create/modify,
  data flow) and wait for approval. Use plan mode for larger tasks.
- Hooks automatically run typecheck + lint after every edit and block
  `git commit` while checks fail. When errors surface, fix them immediately —
  a task is not done until checks pass.
- **Open the session in `admin/`, not its parent folder.** Hooks, permissions
  and the `/commit`, `/review`, `/new-feature` commands are all read from
  `admin/.claude/`, and `$CLAUDE_PROJECT_DIR` in the hook commands resolves to
  the session root. Start one level up and none of it loads — silently, since
  skills still get picked up and everything looks normal.
- New UI primitive → check `src/components/ui/` and shadcn first. Never
  build a primitive from scratch if shadcn provides one.
- One concern per file. A component past ~150 lines → propose a split.
- Imports from `src/` use the `@/` alias. Never `../../`.

## What NOT to do

- Don't use `any`. Use `unknown` and narrow. Last resort: ask.
- Don't call supabase/axios/fetch from components — only through feature
  api hooks.
- Don't store server data in Zustand. Don't put modal booleans in Zustand.
- Don't import another feature's internals — cross-feature imports go
  through its `index.ts`.
- Don't add a dependency without checking package.json and asking first.
- Don't put business logic in `src/components/ui/`.
- Don't edit `src/types/database.ts` by hand.
- Don't commit secrets or `.env` files.
- Don't write comments that restate the code. Comments explain "why".

## Testing

No unit tests in the current phase; revisit once the UI stabilizes.

**Except the pipeline core.** Anything under `src/core/` is gated by
`npm run eval` — a segmentation change that silently loses two questions per
page is invisible in the UI and expensive downstream. The harness lives in
`eval/`, runs free and offline against the real core modules, and its README
states plainly what it does not cover (no model calls, no PDFs, no rendering).
A core change lands with its case in the matching suite.

If asked to write a test ad-hoc (tricky utility, recurring bug), write it;
otherwise skip test files.

## Git & commits

- Conventional Commits required: `feat:`, `fix:`, `chore:`, `refactor:`,
  `docs:`, `style:`, `test:`
- Imperative, lowercase after the prefix. One commit = one logical change;
  if the message needs "and", split it.
- Commits are blocked by hooks while typecheck/lint fail.
- `supabase/migrations/` is part of the codebase, not scratch work: a migration
  is committed together with the code that depends on it.

## Maintaining this file

When a new convention or architecture decision is made in conversation,
propose updating this file in the same session (ask, then edit). Remove
rules that become obsolete. This file must never describe a state that
no longer exists.

## When in doubt

Ask before architectural decisions, new dependencies, or unclear
requirements. One extra question beats ten lines of wrong code.

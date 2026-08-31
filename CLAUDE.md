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

## Branches

Work only on `main`. `agent-probe` is an abandoned experiment — a
browser-driven multi-turn agent loop with tools, Gemini support and image
models inside the loop — kept for reference only. Do not merge it and do not
base anything on it. Its verify/repair ideas may be consulted when the batch
verification stage is built; the architecture below replaces that approach
entirely.

## Where work runs

There is no separate backend for the *interactive* app, but the paid pipeline
is not interactive: it runs as a long-lived worker service. The split is by
what each stage needs.

- **Segmentation and cropping** run in the browser, in a Web Worker (pdf.js +
  canvas). Deterministic, no secrets, no per-page cost.
- **The `worker/` service owns every batch model call.** A long-running
  Node/TypeScript process claims work through the queue RPCs with the service
  role key, builds one structured request per question, submits it to the
  Anthropic Message Batches API, polls, writes the questions back, and finishes
  the claim. It runs under Node's own TypeScript stripping with the eval
  harness's alias loader — no bundler, no build step. It runs on the operator's
  machine today; moving it to a host is an env-var change, so nothing may bake
  in a location.
- **Anthropic only.** Haiku for text-only questions, Sonnet for questions with
  figures. **Both model ids come from worker env vars — never hardcode a model**,
  so a golden-set eval can settle the choice empirically. The system prompt and
  tool schema sit in the cached prefix; the crop image is sent exactly once per
  call. Batch pricing is half of synchronous, which is why nothing paid runs
  synchronously.
- **Where the model is asked WHAT, not WHERE.** Positions inside a crop are
  measured, not requested: `core/segment/option-bands.ts` finds the option rows
  from an ink-and-colour profile and snaps the boxes to them, using the model's
  own boxes only as a hint about where to start looking. The model kept placing
  five options 200 units of the 0-1000 grid above where they were printed, and
  two prompt iterations did not move them onto the rows. The localizer refuses
  rather than guesses — a cell count that does not match the option count is a
  flag, because a confidently wrong box deletes an option and nothing downstream
  can tell that from an option the book never printed.
- **Extraction is ONE structured call per question.** A forced `tool_use` with a
  strict schema returns stem, options, figure spec, category and confidence
  together. No repair round-trip in the extract wave, no separate option-box
  call, no separate category call. The per-book category tree is its own content
  block placed AFTER the stable prefix with its own `cache_control` breakpoint —
  a batch is per-book, so within a run the tree caches too, and a book change
  invalidates only that block instead of the whole prompt.
- **Figures are DSL-first, cleaned-crop as the fallback, and there is no image
  lane at all.** `core/figures` emits SVG as a string for every kind — no DOM, no
  React — so the review screen and the worker draw from one implementation. Marks
  that carry meaning (equal ticks, parallel chevrons, right-angle squares,
  congruent arcs) are DATA on the figure, not strokes a model happened to draw: a
  mark that is a field can be linted, compared, edited on the review screen and
  re-rendered, and one buried in `raw_svg` can only be looked at. Image
  generation is gone entirely — no automated path, no manual fallback, no
  provider key — and re-adding one is a decision, not a configuration change.

  **Where a kind expresses the figure, the kind wins — ON A `cut` BOOK.** That
  lane is lintable, editable and deeply verifiable, and nothing else is.

  **On a `gen` book the kind is not consulted at all.** Every detected figure is
  cut from the original and reproduced from that cut; `rerouteAllToCut` enforces
  it in the pipeline rather than asking the prompt for it. Two reviewed rows
  settled this: both chose `function_graph`, both stayed inside their kind's
  competence, and both drew the wrong graph — one with its marked point sitting
  off the curve it was supposed to lie on. What this gives up is real and is the
  reason the policy is per book and not global: a cut is not lintable, not
  editable and not comparable field by field. The operator trades that for a
  figure that cannot be wrong about the page.

  **Where no kind expresses it, the fallback is a CLEANED REGION OF THE ORIGINAL
  CROP, not a free-drawn `raw_svg`.** A model asked to draw something it cannot
  express does not fail loudly — it writes an apology into the drawing, and one
  live row came back as a single line of text reading "text description not
  possible, look at the original image". Cutting the region costs nothing,
  cannot hallucinate, and shows the reader the real figure. `core/segment/
  image-clean.ts` removes the watermark and the bleed-through while keeping
  saturated pixels, because in these books the colour IS the question and both
  naive thresholds measured at removing 100% of it. The cut is not lintable and
  not editable, so it always lands in review — honest, and strictly better than a
  drawing of an apology.

  **This is the policy, not a direction.** `raw_svg` is gone from the automated
  lane — it is not in the extraction schema and not offered in the prompt, so a
  figure no kind expresses becomes a cleaned cut and nothing else. The type and
  the renderer stay so rows written before the change still open.

  **There IS now an image-generation lane, and on a `gen` book its output is
  what the question SHOWS.** The earlier rule that image generation is gone
  entirely was replaced by an explicit operator decision after a 1:1
  reproduction prompt tested well on real figures. Every book is on the lane —
  `books.figure_render` defaults to `'gen'`, and the `'cut'` setting stays only
  so a book whose figures reproduce badly can be pulled off it. It shipped
  defaulting to `'cut'` and no screen ever exposed the switch, so every book
  imported after the lane was built silently kept the cut and the lane looked
  like it was failing when it had simply never run. The cut is never
  lost — it stays in `ImageFig.src` as the source of truth and as the
  fallback — but the reproduction lands in `genSrc`, the field the renderers
  DISPLAY, whether or not the structural guard was satisfied.

  **The guard is a REVIEWER'S SIGNAL, not a gate on what is displayed, and that
  changed after it was measured against real output.** It compares pixel
  geometry, and a redraw is not a re-photograph: a reviewed rejection scored
  0.16 ink overlap against the 0.85 bar while being a faithful and markedly
  cleaner drawing of the same sets — the circles had moved and resized, which
  is what redrawing IS. Keeping the cut on that verdict made the lane throw
  away its best output and keep a watermarked scan, which is the opposite of
  what the lane is for. An objection now rides along in `genRejected` and as a
  `gen_unverified` flag, so the row reaches review with the reproduction, the
  cut and the objection side by side, and the review screen paints that state
  amber rather than green. What still catches a genuinely wrong drawing is the
  verification wave, which judges MEANING against the original crop instead of
  pixels, and the person in the review queue. Only a reproduction that never
  arrived, or arrived in a format nothing can decode, keeps the cut — with a
  `gen_failed` flag. A missing `GEMINI_API_KEY` turns the lane off rather than
  failing a queue.

  **A stored image's FORMAT comes from its bytes, never from its name.** The
  provider returns JPEG; the lane stored it as `.gen.png` with
  `contentType: image/png` and the renderer declared it `data:image/png`, so
  resvg decoded nothing and painted nothing — and the verification wave
  reported a figure the row actually had as absent, twice, at two repair rounds
  each. A browser and the guard's canvas both sniff, so only the rasteriser
  broke, and only for the reproductions the guard had ACCEPTED.
  `core/figures/image-mime.ts` sniffs and REFUSES rather than defaulting,
  because that default was the defect.

  **The guard compares CONTENT, and every part of it that once compared the
  MEDIUM has been removed.** Its first live run rejected all eight faithful
  reproductions, and not one rejection was about the drawing: a reproduction is
  larger and crisper than the scan it came from, and comparing inked mass,
  thresholding after resampling, or bucketing hue at 45 degrees all measure that
  difference instead of the figure. What survives is measured at a common
  resolution or as a scale-free share — thin lines are compared as skeletons,
  hue as a circular earth-mover distance over 10-degree buckets, coloured area
  as a fraction of its own image.

  **The guard READS THE WRITING too, since a reviewed row lost the name of its
  own axis.** `core/figures/labels.ts` compares the words found on the cut with
  the words found on the reproduction, and a label present in one and absent in
  the other is a refusal. The engine (tesseract.js) lives in `worker/figure-ocr.ts`
  and the JUDGEMENT lives in core, because deciding what noisy OCR output means
  is the part that has to be argued about and pinned. Two measured facts shape
  it: a cleaned cut is ~300px tall and must be upscaled before reading, or the
  engine misreads the cut's own "6" as an "8" and reports a drift that exists
  only inside the OCR; and real labels come back at 88-96 confidence while the
  noise invented from curves and dashes sits at 55-80, so the bar sits above the
  noise. It refuses when unsure. A refusal no longer swaps the
  reproduction back out for the cut — it flags the row and sends it to a
  person — so the cost of refusing is a reviewer's minute rather than a
  discarded drawing, and the cost of staying silent is still a
  cleaner-looking wrong figure in front of a student.

  **Where a channel cannot carry a verdict, the guard ABSTAINS and says so.** On
  a figure drawn entirely in colour the black channel is the question number and
  the labels — 57 pixels of skeleton — so the ink checks stand down
  (`inkMeasurable: false`) and the strict colour checks decide alone. This is
  the one place the guard is deliberately weaker than it looks: a black line
  lost from a colour-dominated figure is not caught here, and is left to the
  verification wave along with the labels. Abstaining silently would have been
  the defect; the flag exists so a caller cannot read silence as a pass.

  The cleaner is `adaptive local contrast + saturation kept + an absolute ink
  floor`, and all three parts are load bearing. Measured over eight real crops:
  dropping the saturation rule removes 100% of the colour, and dropping the ink
  floor promotes 0.4%–3.8% of every page to solid black — a watermark turned
  into strokes, which on a Venn diagram is worse than the marks it replaced.
  Both failures score as success on any count of pale pixels, so
  `inventedInk()` exists and the probe reports it.

  **The untested class is a TRULY SATURATED logo.** What has been proven is a
  pale wash of a warm hue over saturated content — the two separate by
  saturation with a wide margin. A logo printed at content-level saturation
  would defeat the keep-saturated rule by construction, and no such book has
  been seen. That case is theoretical, not cleared. `npm run probe:dewatermark`
  is the gate: run it on any new book whose watermark looks strongly coloured,
  BEFORE trusting the cut lane on it.
- **Verification is a second batch wave.** The worker renders the produced
  question and compares it against the original crop in one Sonnet call, then
  writes a diff and a confidence. Low confidence lands in the existing review
  queue. At most 2 repair iterations, and a repair KEEPS THE BEST version rather
  than the last: the version a repair replaces is parked in
  `questions.prev_version` until the wave has scored its replacement, and a
  repair that scores worse is rolled back with a `repair_rejected` flag. Whether
  a re-read is an improvement cannot be known at extraction time, and before
  this the row could end up worse than before the repair with the evidence
  overwritten in the same update.
- **The browser orchestrates exactly one thing: a single-question interactive
  re-run** from the review screen. That is what the `question-ops` Edge Function
  is still for — that, answer-key parsing and page detection, which stay
  interactive because import needs immediate feedback. It is not a batch path,
  and no batch work may be added to it. Category selection is folded into
  extraction rather than being its own op: the model has read the question by
  the time it could answer, so a second call re-sends the crop to learn nothing.
- **The worker's CONTROL PLANE is in the UI; the worker is not.** The process
  stays a daemon because its independence from any open tab is the point of the
  batch lane — a run that dies when someone closes a window is what this
  replaced. What the UI owns is `worker_control.desired_state`, which the worker
  reads at the top of every pass, and `worker_heartbeat`, which it rewrites on
  each one. A pause therefore lands BETWEEN passes: a submitted batch is already
  paid for, and abandoning it mid-flight would spend the money and keep nothing.
  Liveness is the AGE of the heartbeat, never a status field — a worker that
  died cannot report that it died. Pressing Start with no daemon running writes
  the switch and says so plainly rather than appearing to work.
- **The work list lives in the database.** `questions.queued_at` marks work to
  do and `claimed_at`/`lease_until`/`claimed_by_worker` is a lease, so a worker
  that dies loses at most the batch in flight and a second worker adds
  throughput instead of duplicating spend. Claims go through
  `claim_questions_worker()` (`for update skip locked`); the batch handle
  (`batch_id`, `batch_custom_id`, `batch_stage`) is persisted on the row, so a
  restart resumes polling instead of resubmitting and paying twice.
- Pipeline logic (segmentation, the figure DSL, rendering, lint/verify,
  answer-key parsing) is written as pure, runtime-agnostic modules — no DOM, no
  `import.meta.env` — so the same code runs in the browser, in the worker, in a
  function, and in Node for evals.

The sibling `exam/` folder is a throwaway MVP kept as reference for its
algorithms only. Its architecture — API keys in the browser, anon-writable
tables — is deliberately not carried over.

**Migration status.** Everything above is built except the verification wave.
The worker runs, the browser is out of the batch path, every figure kind renders
from `core`, and there is one provider. What is left is M6: rasterising the
rendered question and comparing it against the original crop, which is also
where `questions.repair_round` starts being used. Until it lands every row the
worker writes is `verified: false` and therefore in the Diqqət lane — that is
correct, not a defect, and a full review queue after a run is expected.

One shim is deliberate and temporary: `parse_answer_key` and `detect_questions`
still express their requests in the Gemini builder dialect, translated at the
door by `geminiToAnthropic`. It works, it keeps prompts and eval fixtures in one
place, and it is scheduled for removal after M6 along with
`core/extract/request-gemini.ts`.

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
- `npm run sample:kinds` / `npm run sample:corruptions` — regenerate the
  committed review pages under `samples/`. Free and offline. Regenerate rather
  than hand-edit: the first figure-kinds page went stale invisibly, still
  claiming marks are carried as data while drawing a congruence arc that was
  byte-identical to a bare label anchor.
- `npm run sample:verify` — the same for the live verification wave, written to
  `local/samples/` because every card embeds a book crop.
- `npm run sample:genlane` — original crop / cleaned cut / guarded reproduction,
  side by side, written to `local/samples/`. COSTS MONEY: one generation per
  figure plus a retry when the guard rejects. Needs `GEMINI_API_KEY` and
  `GEMINI_IMAGE_MODEL`; without them it refuses rather than silently producing
  a two-column page.
- `npm run probe:dewatermark` — before/after for the crop cleaner over real
  crops, written to `local/samples/`. Free and offline. Run it on any newly
  imported book whose watermark is a COLOURED LOGO: keeping saturated pixels is
  what preserves the colour these questions turn on, and it is also what would
  keep a coloured logo, so that case decides how far the cleaned-crop lane can
  go.
- `npm run smoke:request` — validates the extraction request against the real
  Anthropic API with `countTokens`, which is free and bills nothing. Manual, and
  outside the gate because it needs the network. Run it after any change to the
  tool schema, the prompts, or the block order: it catches a schema the API
  would reject on submit, and a cacheable prefix that has stopped being most of
  the request.
- `npm run smoke:queue` — round-trips the worker queue RPCs against the LIVE
  project. Manual and operator-run: it needs the network and the service key,
  so it is deliberately outside `eval` and outside the gate. Run it after any
  migration touching the queue RPCs, the lease predicate, or the columns they
  read — a worker that can claim but not renew looks healthy until its lease
  expires and every row it held is paid for twice. It restores every row it
  touches and makes no model call.
- `npm run worker` — the batch worker. Needs `.env` loaded
  (`set -a; . ./.env; set +a`) for the service-role and Anthropic keys, plus the
  worker's own variables (see `worker/config.ts`, which is their source of
  truth). Spends real money: it claims queued questions and submits them to the
  Batches API.
- `npm run worker:install` — install the worker as an always-on background
  agent (macOS launchd): starts at login, restarts on crash, logs to
  `local/worker.log`. **This is the operator path** — start and pause then live
  in the UI, on the Suallar page, and no terminal is needed again.
  `npm run worker:status` shows whether the agent is loaded and tails the log;
  `npm run worker:uninstall` removes it. The keys are copied from `.env` INTO
  the plist at install time, because a launchd agent gets no login shell — so
  re-run `worker:install` after changing any of them.
- `npm run worker -- --dry-run` — pre-flight for the above. Reads, builds the
  request it WOULD submit, prices it with `countTokens`, and exits. Claims
  nothing, submits nothing, writes nothing — safe against a live queue. Run it
  before every real start: it is the difference between finding a missing crop
  or a wrong model id now and finding it after a few hundred paid questions.
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
- Batch work is paced by the Batches API itself, not by a client gate. The
  shared rate gate (`lib/rate-gate.ts`) covers the browser's *interactive* ops
  only: a provider 429 backs every caller off together and lowers the ceiling,
  because a 429 wastes the paid steps a question already completed.
- `stores/pipeline-store.ts` holds the operator's speed/cost knobs. Every
  default reproduces the careful behaviour; each knob's UI names the risk it
  trades away, not just the saving. Knobs that only tuned image generation have
  no meaning once image-gen leaves the automated lane.
- Cost per question is the call count, not the prompt size. One extract plus one
  verify is the budget; anything that adds a third paid call to the batch lane
  needs a reason written down.
- **Prompt cache hits inside a batch are best-effort.** Batch requests may be
  processed spread out or concurrently, so `cache_read_input_tokens` well below
  100% of the prefix is normal and not a defect. The `ops_log` numbers are a
  measurement, not a pass/fail gate — do not add a threshold on them and do not
  "fix" a partial hit rate. Only a flat zero across a whole batch means
  something is actually broken, and what it means is that the prefix stopped
  being byte-identical. `npm run smoke:request` is where prefix problems are
  caught; the eval pins the prefix itself.

## Hallucination defences

The recreation must copy the source, never improve it. Three independent
layers, none of which the system may self-certify:

1. Temperature 0, copy-only prompt rules, and the PDF text layer as a hint.
2. Deterministic lint (`core/questions/lint.ts`) over the structured result.
3. Render-and-compare: the produced question is rendered (math + vector figure)
   and compared against the original crop in a second batch wave. Agreement is
   what earns `verified`. This covers the figure and the text in one pass,
   because both are in the render.

Anything that fails a layer lands in the Diqqət queue with a flag. Auto-approve
(off by default) only ever passes questions that cleared all three.

This is **three** layers where there used to be four, and the change is load
bearing. The dropped layer was a second, hint-free read compared against the
first — agreement between two independent reads. One structured call per
question is the whole point of the refactor, so that layer cannot survive; layer
3 has to be strictly stronger than it was, not merely cheaper. A verification
wave that agrees with everything is worse than the read it replaced, and the way
to catch that is to compare `verified` rates against questions the old pipeline
already processed, not to trust the new number on its own.

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
samples/                    # committed visual output for review — see its README
eval/                       # core regression suites — `npm run eval`, no deps
worker/                     # the batch worker — `npm run worker`. Node + the
│                           # eval's alias loader, no bundler, no build step.
├── main.ts                 # claim → submit → poll → write back
├── config.ts               # Zod-validated env; every model id lives here
├── db.ts                   # the service-role client, created once
├── queue.ts                # the *_worker queue RPCs
├── batch.ts                # messages.batches create / retrieve / results
├── ops.ts                  # ops_log, ops_cache, the daily budget guard
└── extract.ts              # crop → request → wire → lint → row
src/
├── app/                    # routing, providers, root setup
│   ├── providers.tsx       # QueryClient, auth bootstrap, toaster
│   ├── router.tsx
│   ├── protected-layout.tsx # the one route guard
│   └── App.tsx
├── core/                   # pure pipeline logic: no DOM, no env, no React.
│   │                       # Shared by the app, the worker, functions, evals.
│   ├── segment/            # column/question detection from the text layer
│   ├── extract/            # prompts, wire schemas, request builders
│   ├── figures/            # the figure DSL (FigSpec), evaluators, SVG render
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
- The Supabase anon key is public by design. The `service_role` key must NEVER
  be committed and must NEVER reach the client bundle — not in code, not in any
  tracked file, and never behind a `VITE_` prefix. It lives in the environment of
  the process that needs it: Edge Function secrets for `question-ops`, and the
  worker host's environment for `worker/` (the gitignored `.env` while the worker
  runs on the operator's machine). Nothing under `src/` may read it.
- Model API keys (Anthropic) belong in Edge Function secrets and the worker
  host's environment. A model key behind a `VITE_` prefix is a published key.
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

## Showing work

Anything produced for a human to LOOK at — a rendered figure, a before/after
comparison, a sample of output — is committed under `samples/` with a dated,
self-contained name. Not left in a scratch directory: a reviewer cannot open
what is not in the repo, and a sample nobody can open was not produced.

Book content is the exception, and it goes the other way: a comparison that
embeds crops or pages from a commercial book belongs under `local/`, which is
gitignored for that reason. When real crops are what make a comparison worth
looking at, produce both — the side-by-side in `local/samples/`, and a
synthetic equivalent in `samples/` showing the same behaviour on fixtures
nobody owns.

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
states plainly what it does not cover. A core change lands with its case in the
matching suite.

Two things that make the gate real, and must stay that way:

- **Async cases must be awaited.** A runner that calls a case without `await`
  counts every async assertion as passed the moment it returns a promise. Any
  suite may hold async cases; the runner is what has to be trusted.
- **Prompt and schema changes are eval changes.** `eval/suites/prompts.ts` pins
  invariants that a careless edit trips: contiguous rule numbering in the
  assembled system prompts, a >20-char `description` on every schema field the
  pipeline acts on, and the `confidence` field's stated threshold. Bump
  `PROMPT_VERSION` in the same commit — it keys `ops_cache` and stamps rows.

Rendering is covered too, once figures emit SVG from `core/` rather than React:
an SVG string is assertable offline, so the renderers stop being the one paid
part of the pipeline nothing can check for free.

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

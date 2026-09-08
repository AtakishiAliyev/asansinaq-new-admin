# Deploy

Three pieces, three hosts, and the split is forced by what each one needs.

| Piece | Where | Why there |
| --- | --- | --- |
| The panel (`src/`) | Vercel | Static SPA. No server, no secrets in the bundle. |
| `question-ops` | Supabase Edge Functions | Already there. Answer-key parsing and page detection stay interactive because import needs immediate feedback. |
| The worker (`worker/`) | Render background worker | A process that never stops. Vercel cannot host one. |

The database, storage and auth are Supabase's and are not deployed from here.

## Why the worker cannot go on Vercel

Not a preference — five separate blockers, any one of which is fatal:

- It is an infinite loop with a 60-second poll. Vercel has no long-lived
  processes.
- One provider call may take 180 seconds (`PROVIDER_TIMEOUT_MS`), and an
  express pass over `BATCH_SIZE` questions takes minutes.
- `@napi-rs/canvas` and `@resvg/resvg-js` are native binaries.
- tesseract downloads a ~5MB language model and reuses one engine across
  questions; a serverless filesystem throws that away on every cold start.
- A submitted batch stays in flight for minutes to hours, and its lease has to
  be renewed while it does. Something has to be awake.

Render's **free** plan does not cover this either: free plans exist for web
services and Postgres only, and *"background workers cannot use the Free
plan."* A free web service would also spin down after fifteen minutes without
inbound traffic, which is every minute of this process's life — it polls, it
is never called.

## The panel → Vercel

1. Import the repository. Framework preset **Vite**, build `npm run build`,
   output `dist`. `vercel.json` is already in the repo: SPA rewrites, a CSP
   pinned to the Supabase project, `X-Frame-Options: DENY`, `noindex`.
2. Environment variables — these two, and only these two. Everything the client
   may see is `VITE_`-prefixed and validated in `src/lib/env.ts`:

   ```
   VITE_SUPABASE_URL
   VITE_SUPABASE_ANON_KEY
   ```

   The anon key is public by design. **`SUPABASE_SERVICE_ROLE_KEY` must never
   be set here** — it bypasses RLS and belongs only to the worker.
3. In Supabase → Authentication → URL Configuration, add the Vercel domain as
   the **Site URL** and to **Redirect URLs**. Sign-in is an email OTP; without
   this the codes keep pointing at `localhost` and nobody can log in.

   Prefer changing this in `supabase/config.toml` and running
   `npm run config:push`, so the repository and the project do not drift.

## The worker → Render

`render.yaml` is a Blueprint: point Render at the repository and it creates the
service from that file.

1. **New → Blueprint**, pick the repository. Render reads `render.yaml`.
2. It will ask for the five variables marked `sync: false` — the Supabase URL
   and service-role key, and the Anthropic, Gemini and OpenAI keys. They are
   stored in Render, never in the repository.
3. `WORKER_ID` is `render-1` in the blueprint and must stay unique. **If the
   Mac daemon is still installed, uninstall it** (`npm run worker:uninstall`)
   or make sure the two ids differ: two workers sharing one id each renew and
   release the other's rows, which is the exact failure the lease prevents.

Everything else — the models, the budget, the batch size, the image
resolution — is in `render.yaml` as plain values, so changing one is a commit
rather than a dashboard click.

### What was verified, and what was not

Built and run locally for `linux/amd64`, the architecture Render uses:

- both native modules load and render (`@napi-rs/canvas`, `@resvg/resvg-js`);
- the worker boots, validates its config, reaches Supabase and reads the ledger
  (`--dry-run`, which claims and submits nothing);
- tesseract downloads its model and recognises inside the container, 3.1s.

Not verified: a full paid pass on Render's own hardware. The image is ~1.08 GB
— `dependencies` carries the browser's half of the app, which the worker never
imports but `npm ci` still installs — so expect deploys to take a few minutes.

### If it runs out of CPU

The plan is `0.5c-512mb`, the smallest Render sells. Measured in the container
with every heavy module loaded: **103 MB** resident, so memory has room.

CPU is the part to watch, and only on figure-heavy books: a text question
mostly waits on a provider, while a figure question cuts and cleans a crop,
runs OCR over two images and rasterises a render. Before paying for a bigger
box, try in this order:

1. lower `EXPRESS_CONCURRENCY` (4 → 2) — it is the ceiling on concurrent figure
   work, not just on requests;
2. turn Express **off** and let the batch lane carry it. Batch is half price
   and nearly all waiting, so it costs the worker almost no CPU.

## Cost

Hosting is the cheap part of this system, and it is worth knowing by how much.

| | Monthly |
| --- | --- |
| Vercel | plan-dependent — Hobby is restricted to non-commercial use |
| Render `0.5c-512mb` | one small instance |
| Supabase | free until storage grows past 1 GB — roughly 1 MB per figure question |
| **Model APIs** | **the largest line by far** |

Measured from `ops_log`: **$86.14 between 21 August and 8 September 2026**,
about $4.50 a day, for a few hundred questions. The target is ten thousand.
Optimising the hosting plan saves less than optimising one lane of the
pipeline — the figure lane alone is ~70% of that bill.

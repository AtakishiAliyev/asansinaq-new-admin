# The worker, containerised as what it already is: a process that never stops.
#
# Debian rather than Alpine, deliberately. Two dependencies are native —
# `@napi-rs/canvas` cuts and cleans the crops, `@resvg/resvg-js` rasterises the
# render the verification wave compares — and both ship prebuilt glibc
# binaries. The musl variants are the ones that go missing or stale, and a
# native module that fails to load takes the whole figure lane with it while
# the text lane keeps working, which is the hardest kind of failure to notice.
FROM node:24-slim

ENV NODE_ENV=production

WORKDIR /app

# Dependencies first, so editing a source file does not reinstall them.
#
# `postinstall` copies pdf.js's wasm decoders into `public/` for the BROWSER
# bundle. The worker never reads them — it is handed crops, not PDFs — but the
# script has to exist or `npm ci` fails on a missing postinstall.
COPY package.json package-lock.json ./
COPY scripts/copy-pdfjs-wasm.mjs ./scripts/
RUN npm ci --omit=dev

# No build step and no bundler. Node strips the types itself — the project's
# `erasableSyntaxOnly` guarantees every source file is strippable — and
# `loader.mjs` only teaches it the `@/` alias. What runs in production is the
# same source the eval harness runs.
#
# `core` and `types` only, not all of `src`. The worker imports exactly those
# two trees — `@/core/…` and `@/types/…`, and `core` imports nothing outside
# itself — so copying the React half put code in the image that nothing there
# can reach, and, worse, made every button tweak invalidate this layer and
# rebuild everything after it.
COPY eval/loader.mjs eval/hooks.mjs ./eval/
COPY src/core ./src/core
COPY src/types ./src/types
COPY worker ./worker

# tesseract downloads its ~5MB language model here on first use. The container
# filesystem is ephemeral, so it comes back after each deploy; that is a few
# seconds once, not per question — the engine is created once and reused.
RUN mkdir -p local/tesseract && chown -R node:node /app
USER node

# `node` directly rather than `npm run worker`: npm does not reliably forward
# SIGTERM, and this process has real work to do when it receives one. It
# finishes the pass it is in, records that it stopped on purpose, and leaves
# submitted batches alone — they are paid for and their handles are on the
# rows, so the next container adopts them instead of buying the answers twice.
CMD ["node", "--import", "./eval/loader.mjs", "--disable-warning=ExperimentalWarning", "worker/main.ts", "--daemon"]

# Pipeline core evals

```bash
npm run eval
```

Free, offline, no model call and no PDF: it runs the real modules from
`src/core/` against hand-written inputs and exits non-zero on the first
regression. `CLAUDE.md` gates every change under `src/core/` on this passing.

## Why it exists

A segmentation change that silently loses two questions per page is invisible
in the UI and expensive downstream — the questions are simply never extracted,
and nothing says so. The same is true of a compare rule that stops catching a
digit swap: nothing fails, questions just get verified while being wrong.

## How it runs with no dependencies

Node strips the TypeScript itself (the project's `erasableSyntaxOnly` keeps
every source file strippable) and `loader.mjs` resolves the `@/…` alias. So the
suites import the exact modules the browser and the Edge Function import — not
a copy, not a port. Adding a test framework would have bought nothing here.

## What is covered

| Suite | What it pins down |
| --- | --- |
| `segment` | column split, anchor chains, list rejection, scan fallback, header test number, watermark |
| `answer-key` | table layouts, fused cells, section headers as labels, question pages rejected, numbering gaps |
| `compare` | cosmetic LaTeX equality, prose digit swaps, sign flips, vanished figures |
| `extraction` | wire→question repairs: stray `$`, leaked newlines, merged Venn items |
| `lint` | option count, duplicates, empty stem, broken LaTeX, warning vs error |
| `figures` | curve sampling, set-algebra parsing and its aliases |
| `page-range` | strict and lenient parsing, formatting round-trip |

## What is NOT covered

Say so out loud, because a green run is easy to over-read:

- **No model calls.** Prompt quality, extraction accuracy and figure fidelity
  are not measured here. A paid golden-parity lane against real crops is the
  natural next layer.
- **No PDFs.** `itemsFromContent` (pdf.js item → `SegItem` geometry) and
  `crop.ts` (rendering, ink refinement, figure classification) need a real
  document and a canvas. The fixtures start one step later, at text items.
  Test books are commercial and cannot be committed.
- **No rendering.** The figure renderers and `snapshotFigure` are DOM code.

## Adding a case

Write it in the suite it belongs to, assert the behaviour you actually want,
and run `npm run eval`. Fixtures live in `suites/fixtures.ts`; page geometry is
A4 in PDF points, top-left origin, the same coordinates the segmenter reads.

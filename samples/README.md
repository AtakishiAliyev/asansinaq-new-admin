# Samples

Visual output produced for review — rendered figures, before/after comparisons,
anything that has to be *looked at* rather than asserted.

They live here, committed, because a sample left in a scratch directory cannot
be opened by the person who has to review it. That is the whole rule.

## Conventions

- **Dated name**: `YYYY-MM-DD-what-it-shows.html`. The date is when it was
  produced, so an older sample is obviously older rather than silently stale.
- **Self-contained**: inline the SVG and base64 the images. No `<script src>`,
  no CDN, no relative asset paths — it has to open from disk, on any machine,
  years from now.
- **Say what it is**: a lede at the top explaining what is being shown and what
  the reader is being asked to judge.

## Book content does NOT go here

A sample that embeds crops, pages or any other material from a commercial book
belongs under `local/`, which is gitignored for exactly that reason. Put it at
`local/samples/YYYY-MM-DD-name.html` and say so in the message — the reviewer
has the file on their own machine either way.

When a comparison needs real crops to be worth anything, produce both: the
side-by-side under `local/samples/`, and a synthetic equivalent here that shows
the same rendering behaviour with fixtures nobody owns.

## What is here

- `YYYY-MM-DD-figure-kinds.html` — every figspec kind rendered from `core`,
  produced when the renderers moved out of React.
- `YYYY-MM-DD-verify-corruptions.html` — `npm run sample:corruptions`. Each
  fixture question beside the same question with one deliberate corruption, the
  same damage `scripts/verify-smoke.ts` injects. It is the page to look at
  before trusting a verification score: a difference a reader cannot find here
  is one the model is unlikely to find either, and that is a fact about the
  renderer rather than about the model. Two renderer defects were found exactly
  that way — a congruence arc that drew identically whether or not it was there,
  and maths that painted white-on-white in a dark page.

The live counterpart, `npm run sample:verify`, writes to `local/samples/`
because every card embeds a crop from a commercial book.

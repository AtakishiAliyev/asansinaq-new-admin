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

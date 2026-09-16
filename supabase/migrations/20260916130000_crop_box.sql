-- The operator's own crop box, where they drew one.
--
-- The segmenter decides where a question's crop starts and ends, and it is
-- deterministic: the box is recomputed from the PDF whenever a page is
-- re-imported, which is why it was never stored. That holds until a person
-- corrects it. Twenty-four pages across two books lost their fifth answer to
-- a box the segmenter drew one column too narrow; the rule is fixed, but the
-- next book will find a shape the rule has not seen, and the operator needs a
-- way to fix ONE crop without touching the segmenter.
--
-- Null means "the segmenter's box, whatever it computes today". A value is the
-- box a person drew, in PDF points with a top-left origin — the same frame as
-- the segmenter's own bands — and it outranks the segmenter from then on: a
-- re-import of the page must not quietly redraw a crop someone has already
-- corrected.
alter table public.questions
  add column crop_box jsonb;

comment on column public.questions.crop_box is
  'Operator-drawn crop box {x,y,w,h} in PDF points, top-left origin. Null = the segmenter''s own box. Outranks the segmenter on re-import.';

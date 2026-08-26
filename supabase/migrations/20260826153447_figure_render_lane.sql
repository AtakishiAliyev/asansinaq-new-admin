-- Which figure lane a book uses, so the generation lane can be A/B'd.
--
-- Per BOOK rather than globally, because the question is empirical and the
-- answer will differ by source: a book of clean vector diagrams and a book of
-- grey scans are not the same bet. Defaulting to 'cut' means adding the column
-- changes nothing until a book is deliberately switched over.
alter table public.books
  add column if not exists figure_render text not null default 'cut'
    check (figure_render in ('cut', 'gen'));

comment on column public.books.figure_render is
  'cut = the cleaned region of the original is the figure (default). '
  'gen = a guarded 1:1 reproduction is attempted, and the cut is kept as the '
  'source of truth and as the fallback when the guard rejects it.';

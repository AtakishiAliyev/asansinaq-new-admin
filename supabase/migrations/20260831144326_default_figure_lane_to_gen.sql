-- Every figure is redrawn, so `gen` is what a book gets unless someone changes it.
--
-- The lane shipped defaulting to 'cut' so that adding the column changed
-- nothing until a book was deliberately switched over. Nothing ever switched
-- one: no screen exposes this column, so every book imported after the lane
-- was built silently kept the cut. Twelve questions of a newly imported book
-- came back as watermarked scans for that reason alone — not because the lane
-- judged them, but because it never ran. A default nobody can change is not a
-- default, it is the only setting.
--
-- The column stays rather than being dropped: a book whose figures reproduce
-- badly is still a book someone has to be able to pull off the lane, and that
-- is a one-row update rather than a migration.
alter table public.books
  alter column figure_render set default 'gen';

-- The books already imported were never given the choice either.
update public.books set figure_render = 'gen' where figure_render = 'cut';

comment on column public.books.figure_render is
  'gen = a 1:1 reproduction is drawn and DISPLAYED (default). The cut stays in '
  'ImageFig.src as the source of truth and as the fallback, and a structural '
  'guard objection flags the row for review instead of replacing the drawing. '
  'cut = the cleaned region of the original is the figure, unredrawn.';

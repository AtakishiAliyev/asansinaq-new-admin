-- A structured question may be a picture with no wording.
--
-- Two rules together made that impossible: the column check forbids an empty
-- string, and `questions_structured_complete` demanded a non-null stem for any
-- status past `cropped`. So a legitimate format in these books — one printed
-- instruction above a group, then numbered items that are only a diagram and
-- five options — could not be stored at all. The pipeline generated the figure,
-- paid for it, and then lost the row to constraint 23514.
--
-- The requirement is not "a stem"; it is "something to answer from". A stem or
-- a figure both satisfy that, and options are still mandatory either way. The
-- empty-string ban stays: an absent stem is NULL, never '', so a missing
-- wording can never be mistaken for a present blank one.
alter table public.questions
  drop constraint questions_structured_complete;

alter table public.questions
  add constraint questions_structured_complete
  check (
    status in ('cropped', 'failed', 'rejected')
    or (
      options is not null
      and (
        stem is not null
        or coalesce(
             jsonb_array_length(
               case when jsonb_typeof(figures -> 'items') = 'array'
                    then figures -> 'items' end
             ), 0
           ) > 0
      )
    )
  );

comment on constraint questions_structured_complete on public.questions is
  'A structured question needs options plus something to read: a stem or a figure.';

-- The Diqqət lane, moved into the database.
--
-- It was a client-side predicate over the loaded page, which was honest about
-- what it could do and wrong about what the operator needed: with 50 rows a
-- page, reviewing the flagged questions of a 5,000-question book meant paging
-- through all hundred pages to find them, and the lane had no count at all —
-- there is no way to count rows you have not fetched.
--
-- A GENERATED column rather than a copy maintained by the app: Postgres
-- recomputes it from the same row on every write, so it cannot drift from the
-- rule the way a hand-maintained duplicate would. Changing the rule means
-- changing it here, in one migration, which is also where it becomes reviewable.
alter table public.questions
  add column needs_attention boolean
  generated always as (
    status = 'failed'
    or (
      status = 'structured'
      and (
        not verified
        or flags @> '[{"level":"error"}]'::jsonb
        or flags @> '[{"level":"warning"}]'::jsonb
      )
    )
  ) stored;

comment on column public.questions.needs_attention is
  'Generated: failed, or structured with an unmet second read or any flag. The Diqqət lane.';

-- Both lanes list in the same order the table does, so the index carries the
-- ordering as well as the filter and the page is an index scan either way.
create index questions_attention_idx
  on public.questions (book_id, page_number, col, q_no)
  where needs_attention;

create index questions_clean_idx
  on public.questions (book_id, page_number, col, q_no)
  where status = 'structured' and not needs_attention;

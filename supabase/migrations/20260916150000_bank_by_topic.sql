-- How the bank is spread over subjects, topics and books.
--
-- One row per (subject, topic, book, status) with a count. The overview page
-- draws the topic coverage of a subject from this — which topics hold
-- questions, from how many books, how many of them are approved — and the
-- subject chips above it from the same call with no subject given.
--
-- Server-side, because the bank passed a thousand rows: counted in the
-- browser the picture would stop at PostgREST's page and the chart would show
-- a subject filling up and then, silently, stop. The subject comes through
-- the topic (categories.subject_id), not the book: a question is filed under
-- the operator's topic, and that is the axis the page is about.
--
-- Questions with no topic are left out on purpose. They exist (a crop can be
-- saved before its send names a topic), but a chart of topic coverage has no
-- honest place to draw them.
--
-- `security invoker`, so the tables' RLS applies and a non-admin sees nothing.
create or replace function public.bank_by_topic(p_subject_id bigint default null)
returns table (
  subject_id bigint,
  category_id bigint,
  book_id bigint,
  status text,
  n bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    c.subject_id,
    q.category_id,
    q.book_id,
    q.status,
    count(*)::bigint as n
  from public.questions q
  join public.categories c on c.id = q.category_id
  where p_subject_id is null or c.subject_id = p_subject_id
  group by c.subject_id, q.category_id, q.book_id, q.status
  order by c.subject_id, q.category_id, q.book_id, q.status;
$$;

revoke all on function public.bank_by_topic(bigint) from public, anon;
grant execute on function public.bank_by_topic(bigint) to authenticated;

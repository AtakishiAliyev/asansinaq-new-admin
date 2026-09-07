-- The operator's own pairing of question pages to the key pages that answer them.
--
-- Everything that goes wrong with printed keys goes wrong in one place: knowing
-- WHICH question number 7 is. Every section restarts at 1, so the pipeline has
-- been inferring the section — from a printed "Test N" when the book prints
-- one, otherwise from where the book's own numbering restarts. A survey of nine
-- real books says that inference cannot be made to work:
--
--   * Soru Bankası 2025 A prints Test-1 TWICE on one key page, for two
--     different subjects. Keyed by test number they collide, and the parser
--     drops both — 26 conflicts on a single page.
--   * MANTIK 2025 heads its sections "Deneme 1", which no pattern matches, so
--     six sections collapse into one and every answer conflicts: 409 text items
--     in, zero answers out.
--   * Five of the nine books are pure scans with no text layer at all.
--
-- None of that is a parsing problem. It is a problem of a fact the operator
-- knows and the machine has to guess: these key pages answer THESE question
-- pages. So the operator states it — the import screen already takes both page
-- ranges — and it is kept.
--
-- `answer_keys` is deliberately left alone. Its primary key is
-- (book_id, test_no, q_no), which is exactly what cannot hold two Test-1s, and
-- rewriting it would mean dropping a primary key under 1,740 archived rows and
-- reworking the upsert that maintains them. The new path gets its own tables
-- with their own key, the old path keeps working untouched, and a question with
-- no batch still resolves the way it does today.

create table public.answer_key_batches (
  id bigint generated always as identity primary key,
  book_id bigint not null references public.books (id) on delete cascade,
  -- The crop pages whose questions this key answers, as the operator entered
  -- them. An array rather than a range because "5-10, 17" is a real answer and
  -- a range cannot say it.
  question_pages integer[] not null check (cardinality(question_pages) > 0),
  -- Where the key itself was printed. Kept so a batch can be re-read without
  -- the operator remembering, and so the audit trail says where an answer
  -- came from.
  key_pages integer[] not null check (cardinality(key_pages) > 0),
  -- What the key page called this section ("Test-1", "Deneme 3"), when it said
  -- anything. Metadata only: nothing matches on it, which is the point.
  label text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null
);

comment on table public.answer_key_batches is
  'One operator-stated pairing: these key pages answer the questions cropped '
  'from these question pages. Replaces inferring the section from a printed '
  'test number, which no rule could do correctly across real books.';

create index answer_key_batches_book_idx on public.answer_key_batches (book_id);
-- Postgres does not index a foreign key on its own, and this one is an
-- `on delete set null` target: without it, removing an admin scans the table.
create index answer_key_batches_created_by_idx on public.answer_key_batches (created_by);
-- The lookup is "which batch covers this page", so the array is the filter.
create index answer_key_batches_pages_idx
  on public.answer_key_batches using gin (question_pages);

create table public.answer_key_entries (
  batch_id bigint not null references public.answer_key_batches (id) on delete cascade,
  q_no integer not null check (q_no > 0),
  answer char(1) not null check (answer in ('A', 'B', 'C', 'D', 'E')),
  -- Which key page this one answer was read from, for a disagreement later.
  source_page integer,
  primary key (batch_id, q_no)
);

comment on table public.answer_key_entries is
  'The answers of one batch, by printed question number. Unique per batch, so '
  'a book may hold as many "question 1"s as it prints.';

alter table public.answer_key_batches enable row level security;
alter table public.answer_key_entries enable row level security;

revoke all on public.answer_key_batches from anon;
revoke all on public.answer_key_entries from anon;
grant select, insert, update, delete on public.answer_key_batches to authenticated;
grant select, insert, update, delete on public.answer_key_entries to authenticated;

-- The same predicate every other policy in this schema resolves through, so
-- removing an admin revokes this with everything else.
create policy answer_key_batches_select on public.answer_key_batches
  for select to authenticated using ((select public.is_admin()));
create policy answer_key_batches_insert on public.answer_key_batches
  for insert to authenticated with check ((select public.is_admin()));
create policy answer_key_batches_update on public.answer_key_batches
  for update to authenticated using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy answer_key_batches_delete on public.answer_key_batches
  for delete to authenticated using ((select public.is_admin()));

create policy answer_key_entries_select on public.answer_key_entries
  for select to authenticated using ((select public.is_admin()));
create policy answer_key_entries_insert on public.answer_key_entries
  for insert to authenticated with check ((select public.is_admin()));
create policy answer_key_entries_update on public.answer_key_entries
  for update to authenticated using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy answer_key_entries_delete on public.answer_key_entries
  for delete to authenticated using ((select public.is_admin()));

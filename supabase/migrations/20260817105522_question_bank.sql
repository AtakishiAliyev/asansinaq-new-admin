-- Question bank: every crop the importer extracts is persisted here and
-- review turns rows into the product — approved questions.
--
-- ONE table with a status column, not drafts + questions: crops live in
-- Storage so a row has the same shape from birth (natural key + crop path)
-- through approval; a second table would duplicate RLS/triggers/types and
-- force a copy-on-approve with two sources of truth for "does question X
-- exist". Status is text + CHECK (values will evolve; enums make that a
-- migration). There is deliberately NO transient 'extracting' status: the
-- structuring flow is client-orchestrated, and a crashed tab must not leave
-- rows stranded in a phantom state.
--
-- answer/answer_source/answer_confidence land now but stay nullable; the
-- answer-key step will tighten approval to require them. Approval currently
-- requires a reviewer-confirmed category (RESTRICT — deleting a category
-- with approved questions must fail loudly).

create table public.questions (
  id                bigint generated always as identity primary key,
  book_id           bigint not null references public.books (id) on delete restrict,
  page_number       integer not null check (page_number > 0),
  col               smallint not null check (col in (0, 1)),
  q_no              integer not null check (q_no > 0),
  test_no           integer,

  -- source crop (private 'question-crops' bucket)
  crop_path         text not null,
  crop_mime         text not null check (crop_mime in ('image/png', 'image/jpeg')),
  figure_kind       text not null check (figure_kind in ('colored', 'rule', 'none')),
  is_scan           boolean not null default false,
  text_layer        text,

  -- recreation (null until structured)
  status            text not null default 'cropped'
                      check (status in ('cropped', 'structured', 'approved', 'rejected', 'failed')),
  stem              text check (stem is null or length(btrim(stem)) > 0),
  options           jsonb,
  figures           jsonb,
  answer            char(1) check (answer in ('A', 'B', 'C', 'D', 'E')),
  answer_source     text check (answer_source in ('key', 'solver', 'reviewer')),
  answer_confidence real check (answer_confidence between 0 and 1),
  ai_category_id    bigint references public.categories (id) on delete set null,
  ai_category_confidence real check (ai_category_confidence between 0 and 1),
  category_id       bigint references public.categories (id) on delete restrict,
  ai_difficulty     smallint check (ai_difficulty between 1 and 5),
  reviewer_difficulty smallint check (reviewer_difficulty between 1 and 5),
  empirical_difficulty real,      -- future student-attempts phase; stays null

  -- pipeline provenance
  model             text,
  flags             jsonb not null default '[]',
  verified          boolean not null default false,
  extraction_error  text,
  created_by        uuid references public.profiles (id) on delete set null,
  reviewed_by       uuid references public.profiles (id) on delete set null,
  reviewed_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint questions_source_key unique (book_id, page_number, col, q_no),
  constraint questions_structured_complete
    check (status in ('cropped', 'failed') or (stem is not null and options is not null)),
  constraint questions_approved_complete
    check (status <> 'approved' or category_id is not null)
);

create index questions_book_status_idx on public.questions (book_id, status);
create index questions_review_queue_idx on public.questions (status)
  where status in ('structured', 'failed');
create index questions_category_idx on public.questions (category_id);
create index questions_ai_category_idx on public.questions (ai_category_id);
create index questions_created_by_idx on public.questions (created_by);
create index questions_reviewed_by_idx on public.questions (reviewed_by);

create trigger questions_set_updated_at
  before update on public.questions
  for each row execute function public.set_updated_at();

revoke all on public.questions from anon;
grant select, insert, update, delete on public.questions to authenticated;
alter table public.questions enable row level security;

create policy questions_select on public.questions
  for select to authenticated using ((select public.is_admin()));
create policy questions_insert on public.questions
  for insert to authenticated with check ((select public.is_admin()));
create policy questions_update on public.questions
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy questions_delete on public.questions
  for delete to authenticated using ((select public.is_admin()));

-- Printed answer keys, parsed from the book's answer pages. CASCADE (unlike
-- questions): keys carry no review labor and are worthless without the book.
-- test_no 0 means the book/section has no test structure; the matching rule
-- everywhere is (book_id, coalesce(questions.test_no, 0), q_no).
create table public.answer_keys (
  book_id     bigint not null references public.books (id) on delete cascade,
  test_no     integer not null default 0,
  q_no        integer not null check (q_no > 0),
  answer      char(1) not null check (answer in ('A', 'B', 'C', 'D', 'E')),
  source_page integer,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (book_id, test_no, q_no)
);

create index answer_keys_created_by_idx on public.answer_keys (created_by);

revoke all on public.answer_keys from anon;
grant select, insert, update, delete on public.answer_keys to authenticated;
alter table public.answer_keys enable row level security;

create policy answer_keys_select on public.answer_keys
  for select to authenticated using ((select public.is_admin()));
create policy answer_keys_insert on public.answer_keys
  for insert to authenticated with check ((select public.is_admin()));
create policy answer_keys_update on public.answer_keys
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy answer_keys_delete on public.answer_keys
  for delete to authenticated using ((select public.is_admin()));

-- Private bucket for question crops and generated figure/option images.
-- 5MB: crops measure ~50-400KB, generated images ~100-500KB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'question-crops',
  'question-crops',
  false,
  5242880,
  array['image/png', 'image/jpeg']
)
on conflict (id) do nothing;

create policy question_crops_select on storage.objects
  for select to authenticated
  using (bucket_id = 'question-crops' and (select public.is_admin()));
create policy question_crops_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'question-crops' and (select public.is_admin()));
create policy question_crops_update on storage.objects
  for update to authenticated
  using (bucket_id = 'question-crops' and (select public.is_admin()))
  with check (bucket_id = 'question-crops' and (select public.is_admin()));
create policy question_crops_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'question-crops' and (select public.is_admin()));

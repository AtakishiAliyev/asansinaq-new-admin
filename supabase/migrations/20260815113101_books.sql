-- One row per uploaded question-bank PDF. Metadata lives here, not in storage
-- filenames: at hundreds of books the archive is searched and filtered through
-- this table, and later phases hang provenance off it (every question will
-- reference the book+page it came from; answer-key ranges and processing
-- status will attach here too).

-- Lets books assert "my subject belongs to my program" declaratively.
create unique index subjects_id_program_key on public.subjects (id, program_id);

create table public.books (
  id bigint generated always as identity primary key,
  title text not null,
  program_id bigint not null references public.programs (id) on delete restrict,
  subject_id bigint,
  tags text[] not null default '{}',
  note text,
  -- Null when the file exceeded the bucket limit and only metadata is kept.
  storage_path text unique,
  original_name text not null,
  file_size bigint not null,
  page_count integer,
  -- SHA-256 of the file, for duplicate detection at upload time.
  content_hash text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint books_title_not_blank check (btrim(title) <> ''),
  constraint books_title_length check (char_length(title) <= 200),
  constraint books_note_length check (note is null or char_length(note) <= 2000),
  constraint books_tag_count check (array_length(tags, 1) is null or array_length(tags, 1) <= 20)
);

-- Subject must belong to the chosen program. RESTRICT: a subject referenced by
-- books cannot be deleted until those books drop it.
alter table public.books
  add constraint books_subject_same_program
  foreign key (subject_id, program_id)
  references public.subjects (id, program_id);

create unique index books_content_hash_key
  on public.books (content_hash)
  where content_hash is not null;

create index books_program_id_idx on public.books (program_id);
create index books_subject_id_idx on public.books (subject_id);
create index books_created_by_idx on public.books (created_by);
create index books_tags_idx on public.books using gin (tags);

create trigger books_set_updated_at
  before update on public.books
  for each row execute function public.set_updated_at();

create function public.trim_book_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.title = btrim(new.title);
  new.note = nullif(btrim(coalesce(new.note, '')), '');
  return new;
end;
$$;

create trigger books_trim_fields
  before insert or update on public.books
  for each row execute function public.trim_book_fields();

revoke all on public.books from anon;
grant select, insert, update, delete on public.books to authenticated;

alter table public.books enable row level security;

create policy books_select on public.books
  for select to authenticated using ((select public.is_admin()));
create policy books_insert on public.books
  for insert to authenticated with check ((select public.is_admin()));
create policy books_update on public.books
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy books_delete on public.books
  for delete to authenticated using ((select public.is_admin()));

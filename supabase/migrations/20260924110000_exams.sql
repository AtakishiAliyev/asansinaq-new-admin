-- Exams (denemes), their draft composition, and their published versions.
--
-- An exam has ONE draft — `exam_items`, the questions in each section and
-- their order, which the builder edits freely and saves as it goes — and any
-- number of published VERSIONS. Publishing copies the draft into a new
-- version together with a SNAPSHOT of every question as it stood at that
-- moment: its wording, options, answer, difficulty, topic and figures.
--
-- The snapshot is the point. A question in the bank keeps changing after it
-- is approved — it is re-read, its crop is redrawn, its approval is pulled
-- back — and a student's attempt has to keep meaning what it meant when they
-- sat it. So an attempt (next phase) binds to a version, never to the draft,
-- and editing a published exam is simply publishing again: those already
-- mid-way finish the version they started, and everyone after gets the new
-- one.

create table public.exams (
  id bigint generated always as identity primary key,
  program_id bigint not null,
  template_id bigint not null,
  -- The number in the name, per program. Assigned by `exam_create`.
  seq integer not null check (seq > 0),
  title text not null check (length(trim(title)) > 0),
  -- Whether students see it at all. Meaningful only once published.
  is_visible boolean not null default false,
  -- Reserved for gating (a paid plan, a level). Null means every student.
  -- Nothing reads it yet; it exists so gating arrives as a feature, not as
  -- a migration of every exam.
  access_rule text,
  current_version_id bigint,
  -- Moves on every draft edit; newer than the current version's
  -- `published_at` means there are unpublished changes.
  draft_updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (program_id, seq),
  -- An exam's program is its template's program, declared, not checked.
  foreign key (template_id, program_id)
    references public.exam_templates (id, program_id) on delete restrict
);

create index exams_template_idx on public.exams (template_id, program_id);
create index exams_created_by_idx on public.exams (created_by);

create trigger exams_set_updated_at
  before update on public.exams
  for each row execute function public.set_updated_at();

-- The draft: which question sits in which slot. Section positions refer to
-- the template's sections; positions run 1..n within a section.
--
-- The same question may not appear twice in ONE exam. Across exams it may —
-- the builder warns, it does not refuse.
--
-- CASCADE from the question: a draft slot is not worth blocking a deletion
-- in the bank over, and the builder shows the gap.
create table public.exam_items (
  exam_id bigint not null references public.exams (id) on delete cascade,
  section_position smallint not null check (section_position > 0),
  position smallint not null check (position > 0),
  question_id bigint not null references public.questions (id) on delete cascade,
  primary key (exam_id, section_position, position),
  unique (exam_id, question_id)
);

-- "In how many exams is this question?" is asked of every row the builder
-- lists.
create index exam_items_question_idx on public.exam_items (question_id, exam_id);

create table public.exam_versions (
  id bigint generated always as identity primary key,
  exam_id bigint not null references public.exams (id) on delete cascade,
  version_no integer not null check (version_no > 0),
  -- The template's rules as they were at publish time: sections, time,
  -- navigation, pause and retake policy, scoring. Scoring an attempt reads
  -- these, never the template, so a template edit cannot re-score the past.
  rules jsonb not null,
  duration_seconds integer not null check (duration_seconds > 0),
  question_count smallint not null check (question_count > 0),
  max_score numeric(9, 4) not null,
  published_at timestamptz not null default now(),
  published_by uuid references public.profiles (id) on delete set null,
  unique (exam_id, version_no)
);

create index exam_versions_published_by_idx on public.exam_versions (published_by);

alter table public.exams
  add constraint exams_current_version_fkey
  foreign key (current_version_id) references public.exam_versions (id)
  on delete set null;
create index exams_current_version_idx on public.exams (current_version_id);

-- One row per question of a published version: the snapshot.
--
-- `question_id` keeps the link back to the bank for analytics and for
-- "this question has changed since it was published", and goes null rather
-- than blocking if the bank row is ever deleted — the snapshot is complete
-- on its own.
--
-- `figures` is the figure plate RENDERED to SVG at publish time, and image
-- options carry a public URL. The student app has no figure renderer and no
-- access to the private crop bucket, so it is handed finished markup and
-- public images and nothing it would have to interpret.
create table public.exam_version_items (
  version_id bigint not null references public.exam_versions (id) on delete cascade,
  -- 1..N across the whole version, the order a student meets them in.
  seq smallint not null check (seq > 0),
  section_position smallint not null check (section_position > 0),
  position smallint not null check (position > 0),
  question_id bigint references public.questions (id) on delete set null,
  subject_id bigint not null references public.subjects (id) on delete restrict,
  category_id bigint references public.categories (id) on delete set null,
  difficulty smallint,
  stem text not null,
  -- [{ label, tex?, image_url? }]
  options jsonb not null,
  answer char(1) not null check (answer in ('A', 'B', 'C', 'D', 'E')),
  -- { direction: 'row' | 'column', svgs: string[] }, or null.
  figures jsonb,
  -- The bank row's `updated_at` when it was copied: newer in the bank now
  -- means the question has been edited since this version went out.
  question_updated_at timestamptz,
  primary key (version_id, seq),
  unique (version_id, section_position, position)
);

create index exam_version_items_question_idx on public.exam_version_items (question_id);
create index exam_version_items_subject_idx on public.exam_version_items (subject_id);
create index exam_version_items_category_idx on public.exam_version_items (category_id);

-- ── access: the admin panel only ────────────────────────────────────────────
-- Students reach published versions through functions in the next phase,
-- which hand out everything but `answer`.

revoke all on public.exams, public.exam_items, public.exam_versions,
  public.exam_version_items from anon;
grant select, insert, update, delete on public.exams, public.exam_items,
  public.exam_versions, public.exam_version_items to authenticated;

alter table public.exams enable row level security;
alter table public.exam_items enable row level security;
alter table public.exam_versions enable row level security;
alter table public.exam_version_items enable row level security;

create policy exams_select on public.exams
  for select to authenticated using ((select public.is_admin()));
create policy exams_insert on public.exams
  for insert to authenticated with check ((select public.is_admin()));
create policy exams_update on public.exams
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy exams_delete on public.exams
  for delete to authenticated using ((select public.is_admin()));

create policy exam_items_select on public.exam_items
  for select to authenticated using ((select public.is_admin()));
create policy exam_items_insert on public.exam_items
  for insert to authenticated with check ((select public.is_admin()));
create policy exam_items_update on public.exam_items
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy exam_items_delete on public.exam_items
  for delete to authenticated using ((select public.is_admin()));

-- Versions are written once and never edited: no update policy at all.
create policy exam_versions_select on public.exam_versions
  for select to authenticated using ((select public.is_admin()));
create policy exam_versions_insert on public.exam_versions
  for insert to authenticated with check ((select public.is_admin()));
create policy exam_versions_delete on public.exam_versions
  for delete to authenticated using ((select public.is_admin()));

create policy exam_version_items_select on public.exam_version_items
  for select to authenticated using ((select public.is_admin()));
create policy exam_version_items_insert on public.exam_version_items
  for insert to authenticated with check ((select public.is_admin()));
create policy exam_version_items_delete on public.exam_version_items
  for delete to authenticated using ((select public.is_admin()));

-- ── published figures ───────────────────────────────────────────────────────
-- A PUBLIC bucket, and the only one. `question-crops` stays closed: it holds
-- every crop of every commercial book, and a student needs exactly the
-- figures of the questions in exams they can open. Publishing copies those
-- and nothing else here, so what is public is what has been published.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'exam-assets',
  'exam-assets',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

create policy exam_assets_select on storage.objects
  for select to authenticated
  using (bucket_id = 'exam-assets' and (select public.is_admin()));
create policy exam_assets_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'exam-assets' and (select public.is_admin()));
create policy exam_assets_update on storage.objects
  for update to authenticated
  using (bucket_id = 'exam-assets' and (select public.is_admin()))
  with check (bucket_id = 'exam-assets' and (select public.is_admin()));
create policy exam_assets_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'exam-assets' and (select public.is_admin()));

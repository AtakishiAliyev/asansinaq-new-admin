-- Deneme templates: the RULES of one kind of mock exam, per program.
--
-- The exam system is program-agnostic from its first table. YÖS ships first,
-- SAT and DİM are expected later, and nothing here may assume which one it is
-- serving: the word "YÖS" appears only in the seed rows at the bottom, never
-- in a table or a column. What differs between programs is DATA — how many
-- sections, how many questions each, how long, how a score is computed — and
-- that data lives in a template.
--
-- The vocabulary follows IMS QTI, the interoperability standard for tests: a
-- test is made of ordered sections, each drawing items from a pool, with time
-- limits, a navigation mode and outcome (scoring) rules. A template is the
-- blueprint; an exam is built from one; a published exam VERSION copies the
-- template's rules at that moment, so editing a template later never changes
-- a score a student has already been given.

-- A section may only use a subject of its template's own program. Declared
-- rather than checked in a trigger, through the composite key
-- `subjects_id_program_key` that `books` already references the same way.

create table public.exam_templates (
  id bigint generated always as identity primary key,
  program_id bigint not null references public.programs (id) on delete restrict,
  name text not null check (length(trim(name)) > 0),
  -- How a new exam built from this template is named. `{nn}` is the exam's
  -- sequence number within its program, zero-padded to two digits.
  name_pattern text not null check (position('{nn}' in name_pattern) > 0),
  -- The whole test's time limit. A section may carry its own as well.
  duration_seconds integer not null check (duration_seconds > 0),
  -- QTI's navigationMode: 'free' lets a student move between any questions,
  -- 'linear' only forward.
  navigation text not null default 'free'
    check (navigation in ('free', 'linear')),
  -- Whether the clock stops while the student is away. Paused time is what
  -- makes "leave now, finish tomorrow" possible, at the price of the test no
  -- longer being a strict timed sitting.
  pause_on_exit boolean not null default true,
  allow_retake boolean not null default true,
  reveal_answers text not null default 'after_submit'
    check (reveal_answers in ('after_submit', 'never')),
  -- 'linear': base + Σ over sections of (net correct × points), where net is
  -- correct − wrong × penalty_ratio, floored at zero per section. A scaled
  -- method (raw score → table, as SAT reports) gets its own value when it is
  -- built; the column exists so adding it is not a migration of every row.
  scoring_method text not null default 'linear'
    check (scoring_method in ('linear')),
  base_score numeric(9, 4) not null default 0 check (base_score >= 0),
  min_score numeric(9, 4) not null default 0 check (min_score >= 0),
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (program_id, name),
  -- The target of the composite key on sections and exams.
  unique (id, program_id)
);

comment on table public.exam_templates is
  'The rules of one kind of mock exam in a program: sections, time, navigation, scoring. Copied into each published exam version.';

create table public.exam_template_sections (
  template_id bigint not null,
  program_id bigint not null,
  position smallint not null check (position > 0),
  subject_id bigint not null,
  question_count smallint not null check (question_count between 1 and 500),
  -- Null: the section shares the test's clock, which is how every YÖS
  -- template works. Set, it is a separately timed module.
  duration_seconds integer check (duration_seconds is null or duration_seconds > 0),
  points_correct numeric(9, 4) not null check (points_correct >= 0),
  -- 0.25 is "four wrong answers cancel one right one".
  penalty_ratio numeric(6, 4) not null default 0
    check (penalty_ratio between 0 and 1),
  primary key (template_id, position),
  unique (template_id, subject_id),
  foreign key (template_id, program_id)
    references public.exam_templates (id, program_id) on delete cascade,
  foreign key (subject_id, program_id)
    references public.subjects (id, program_id) on delete restrict
);

create index exam_template_sections_subject_idx
  on public.exam_template_sections (subject_id, program_id);

create trigger exam_templates_set_updated_at
  before update on public.exam_templates
  for each row execute function public.set_updated_at();

-- ── access: the admin panel only ────────────────────────────────────────────
-- Students never read a template. What they need of its rules reaches them
-- through a published version, by function, in the next phase.

revoke all on public.exam_templates, public.exam_template_sections from anon;
grant select, insert, update, delete
  on public.exam_templates, public.exam_template_sections to authenticated;
alter table public.exam_templates enable row level security;
alter table public.exam_template_sections enable row level security;

create policy exam_templates_select on public.exam_templates
  for select to authenticated using ((select public.is_admin()));
create policy exam_templates_insert on public.exam_templates
  for insert to authenticated with check ((select public.is_admin()));
create policy exam_templates_update on public.exam_templates
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy exam_templates_delete on public.exam_templates
  for delete to authenticated using ((select public.is_admin()));

create policy exam_template_sections_select on public.exam_template_sections
  for select to authenticated using ((select public.is_admin()));
create policy exam_template_sections_insert on public.exam_template_sections
  for insert to authenticated with check ((select public.is_admin()));
create policy exam_template_sections_update on public.exam_template_sections
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy exam_template_sections_delete on public.exam_template_sections
  for delete to authenticated using ((select public.is_admin()));

-- ── the YÖS templates ───────────────────────────────────────────────────────
-- Decided with the product owner on 2026-09-24. The full test is 80 questions
-- on ONE 100-minute clock — not the 95 its parts would add up to — in the
-- order Mantık, Matematik, Geometri, scored out of 500: 100 given to every
-- student, then 4.75 a question in Mantık and 5.25 in Matematik and
-- Geometri, four wrong answers cancelling one right one in every section.
-- A single-subject deneme has no base and is reported against its own
-- maximum; the rule is the same, only the base differs.
--
-- Subjects are found by name so this does not depend on ids, and the block
-- refuses loudly if one is missing rather than seeding a template with a
-- section quietly left out.
do $$
declare
  v_program bigint;
  v_mantik bigint;
  v_matematik bigint;
  v_geometri bigint;
  v_full bigint;
  v_one bigint;
begin
  select id into v_program from public.programs where name = 'YÖS';
  if v_program is null then
    raise exception 'exam_templates seed: program "YÖS" not found';
  end if;

  select id into v_mantik from public.subjects
    where program_id = v_program and name = 'Mantık';
  select id into v_matematik from public.subjects
    where program_id = v_program and name = 'Matematik';
  select id into v_geometri from public.subjects
    where program_id = v_program and name = 'Geometri';
  if v_mantik is null or v_matematik is null or v_geometri is null then
    raise exception 'exam_templates seed: a YÖS subject is missing (Mantık %, Matematik %, Geometri %)',
      v_mantik, v_matematik, v_geometri;
  end if;

  insert into public.exam_templates
    (program_id, name, name_pattern, duration_seconds, base_score, min_score, sort_order)
  values (v_program, 'Tam TR-YÖS', 'TR-YÖS Deneme {nn}', 6000, 100, 100, 1)
  returning id into v_full;
  insert into public.exam_template_sections
    (template_id, program_id, position, subject_id, question_count, points_correct, penalty_ratio)
  values
    (v_full, v_program, 1, v_mantik, 40, 4.75, 0.25),
    (v_full, v_program, 2, v_matematik, 30, 5.25, 0.25),
    (v_full, v_program, 3, v_geometri, 10, 5.25, 0.25);

  insert into public.exam_templates
    (program_id, name, name_pattern, duration_seconds, sort_order)
  values (v_program, 'Mantık', 'TR-YÖS Deneme {nn}', 3000, 2)
  returning id into v_one;
  insert into public.exam_template_sections
    (template_id, program_id, position, subject_id, question_count, points_correct, penalty_ratio)
  values (v_one, v_program, 1, v_mantik, 40, 4.75, 0.25);

  insert into public.exam_templates
    (program_id, name, name_pattern, duration_seconds, sort_order)
  values (v_program, 'Matematik', 'TR-YÖS Deneme {nn}', 1800, 3)
  returning id into v_one;
  insert into public.exam_template_sections
    (template_id, program_id, position, subject_id, question_count, points_correct, penalty_ratio)
  values (v_one, v_program, 1, v_matematik, 30, 5.25, 0.25);

  insert into public.exam_templates
    (program_id, name, name_pattern, duration_seconds, sort_order)
  values (v_program, 'Geometri', 'TR-YÖS Deneme {nn}', 900, 4)
  returning id into v_one;
  insert into public.exam_template_sections
    (template_id, program_id, position, subject_id, question_count, points_correct, penalty_ratio)
  values (v_one, v_program, 1, v_geometri, 10, 5.25, 0.25);
end $$;

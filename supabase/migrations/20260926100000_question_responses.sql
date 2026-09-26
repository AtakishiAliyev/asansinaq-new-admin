-- The FACT of a student meeting a question: one row per question per
-- handed-in sitting, whatever the sitting was. Today the only context is a
-- deneme; topic tests and roadmaps will write the same rows with their own
-- `context_kind`, so every question's analytics is one query over one
-- table, and every context's analytics is a GROUP BY on the same table.
--
-- Rows are written by the server at hand-in, never by the student, and
-- read only by admins. They denormalise what the item was at the time
-- (subject, category, difficulty, key) because the bank row can be edited
-- or deleted later and an analysis of last month must not move.
--
-- Per-question TIME is derived from the event log: the browser reports
-- when a question is opened, paused and left, and `attempt_answer` records
-- every answer on the server. Between two events the open question is
-- charged for the gap, capped so a lost event cannot charge a night.

create table public.question_responses (
  id bigint generated always as identity primary key,
  question_id bigint references public.questions (id) on delete set null,
  user_id uuid not null references auth.users (id) on delete cascade,
  context_kind text not null
    check (context_kind in ('deneme', 'topic_test', 'roadmap', 'placement')),
  -- The deneme's exam id; a topic test's or roadmap step's own id later.
  context_id bigint not null,
  context_version_id bigint,
  context_attempt_id bigint,
  context_seq smallint not null,
  attempt_no integer not null default 1,
  -- The item as it was when it was sat.
  subject_id bigint,
  category_id bigint,
  difficulty smallint,
  answer char(1) not null,
  choice char(1),
  is_correct boolean not null,
  is_blank boolean not null,
  time_seconds integer,
  -- Answers changed or cleared after the first; 0 for a single decision.
  change_count integer not null default 0,
  board_used boolean not null default false,
  -- The student had opened this exam's answer key on an earlier attempt:
  -- a score after that measures memory, not learning.
  answers_seen_before boolean not null default false,
  answered_at timestamptz,
  recorded_at timestamptz not null default now(),
  unique (context_kind, context_attempt_id, context_seq)
);

create index question_responses_question_idx
  on public.question_responses (question_id, recorded_at desc);
create index question_responses_context_idx
  on public.question_responses (context_kind, context_id, recorded_at desc);
create index question_responses_user_idx
  on public.question_responses (user_id, recorded_at desc);
create index question_responses_category_idx
  on public.question_responses (category_id)
  where category_id is not null;

comment on table public.question_responses is
  'One row per question per handed-in sitting, across every context (deneme, topic test, roadmap). Written by the server at hand-in; read by admins for analytics.';

alter table public.question_responses enable row level security;
create policy question_responses_admin_select on public.question_responses
  for select to authenticated using ((select public.is_admin()));
grant select on public.question_responses to authenticated;

-- ── recording a deneme sitting ──────────────────────────────────────────────
create or replace function public.attempt_record_responses(p_attempt_id bigint)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  a public.exam_attempts;
  v_seen boolean;
  v_cap constant integer := 300;
  ev record;
  v_open_seq integer := null;
  v_open_at timestamptz := null;
  v_time jsonb := '{}'::jsonb;
  v_gap integer;
  v_written integer;
begin
  select * into a from public.exam_attempts where id = p_attempt_id;
  if not found or a.status <> 'submitted' then
    return 0;
  end if;

  -- Time per question, walked once through the sitting's events in order.
  -- An `open` starts charging its question; a pause, an exit or the hand-in
  -- stops charging; every other event (an answer, the board) just moves
  -- the clock along.
  for ev in
    select e.seq, e.kind, e.at
    from public.attempt_events e
    where e.attempt_id = a.id
    order by e.at, e.id
  loop
    if v_open_seq is not null then
      v_gap := least(v_cap, greatest(0, extract(epoch from ev.at - v_open_at)::integer));
      v_time := jsonb_set(
        v_time,
        array[v_open_seq::text],
        to_jsonb(coalesce((v_time ->> v_open_seq::text)::integer, 0) + v_gap)
      );
      v_open_at := ev.at;
    end if;
    if ev.kind = 'open' and ev.seq is not null then
      v_open_seq := ev.seq;
      v_open_at := ev.at;
    elsif ev.kind in ('pause', 'exit', 'submit') then
      v_open_seq := null;
      v_open_at := null;
    end if;
  end loop;

  select exists (
    select 1 from public.exam_attempts x
    where x.user_id = a.user_id and x.exam_id = a.exam_id
      and x.attempt_no < a.attempt_no and x.answers_revealed_at is not null
  ) into v_seen;

  insert into public.question_responses (
    question_id, user_id, context_kind, context_id, context_version_id,
    context_attempt_id, context_seq, attempt_no, subject_id, category_id,
    difficulty, answer, choice, is_correct, is_blank, time_seconds,
    change_count, board_used, answers_seen_before, answered_at
  )
  select
    i.question_id, a.user_id, 'deneme', a.exam_id, a.version_id,
    a.id, i.seq, a.attempt_no, i.subject_id, i.category_id,
    i.difficulty, i.answer, r.choice,
    r.choice is not null and r.choice = i.answer,
    r.choice is null,
    (v_time ->> i.seq::text)::integer,
    (select count(*)::integer from public.attempt_events e
      where e.attempt_id = a.id and e.seq = i.seq and e.kind in ('change', 'clear')),
    exists (
      select 1 from public.attempt_sketches s
      where s.attempt_id = a.id and s.seq = i.seq and s.layer = 'board'
        and jsonb_array_length(coalesce(s.data -> 'objects', '[]'::jsonb)) > 0
    ),
    v_seen,
    r.updated_at
  from public.exam_version_items i
  left join public.attempt_responses r on r.attempt_id = a.id and r.seq = i.seq
  where i.version_id = a.version_id
  on conflict (context_kind, context_attempt_id, context_seq) do nothing;

  get diagnostics v_written = row_count;
  return v_written;
end;
$$;

revoke all on function public.attempt_record_responses(bigint) from public, anon, authenticated;

-- ── hand-in records the facts ───────────────────────────────────────────────
-- attempt_finalize, as before, plus one call at the end.
create or replace function public.attempt_finalize(p_attempt_id bigint, p_by text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  a public.exam_attempts;
  v_rules jsonb;
  v_sections jsonb := '[]'::jsonb;
  v_score numeric := 0;
  v_max numeric := 0;
  v_correct integer := 0;
  v_wrong integer := 0;
  v_blank integer := 0;
  s jsonb;
  s_correct integer;
  s_wrong integer;
  s_blank integer;
  s_net numeric;
  s_points numeric;
begin
  select * into a from public.exam_attempts where id = p_attempt_id for update;
  if not found or a.status <> 'in_progress' then
    return;
  end if;
  select v.rules into v_rules from public.exam_versions v where v.id = a.version_id;

  for s in select * from jsonb_array_elements(v_rules -> 'sections') loop
    select
      count(*) filter (where r.choice = i.answer),
      count(*) filter (where r.choice is not null and r.choice <> i.answer),
      count(*) filter (where r.choice is null)
      into s_correct, s_wrong, s_blank
    from public.exam_version_items i
    left join public.attempt_responses r on r.attempt_id = a.id and r.seq = i.seq
    where i.version_id = a.version_id
      and i.section_position = (s ->> 'position')::integer;

    s_net := greatest(0, s_correct - s_wrong * coalesce((s ->> 'penalty_ratio')::numeric, 0));
    s_points := s_net * (s ->> 'points_correct')::numeric;

    v_sections := v_sections || jsonb_build_object(
      'position', (s ->> 'position')::integer,
      'subject_name', s ->> 'subject_name',
      'correct', s_correct,
      'wrong', s_wrong,
      'blank', s_blank,
      'net', s_net,
      'points', round(s_points, 4),
      'max', (s ->> 'question_count')::numeric * (s ->> 'points_correct')::numeric
    );
    v_score := v_score + s_points;
    v_max := v_max + (s ->> 'question_count')::numeric * (s ->> 'points_correct')::numeric;
    v_correct := v_correct + s_correct;
    v_wrong := v_wrong + s_wrong;
    v_blank := v_blank + s_blank;
  end loop;

  v_score := v_score + coalesce((v_rules ->> 'base_score')::numeric, 0);
  v_max := v_max + coalesce((v_rules ->> 'base_score')::numeric, 0);
  v_score := greatest(v_score, coalesce((v_rules ->> 'min_score')::numeric, 0));

  update public.exam_attempts
  set status = 'submitted',
      submitted_at = now(),
      submitted_by = p_by,
      score = round(v_score, 4),
      max_score = round(v_max, 4),
      correct_count = v_correct,
      wrong_count = v_wrong,
      blank_count = v_blank,
      section_scores = v_sections
  where id = a.id;

  insert into public.attempt_events (attempt_id, kind, payload, at)
  values (a.id, 'submit', jsonb_build_object('by', p_by), now());

  perform public.attempt_record_responses(a.id);
end;
$$;

revoke all on function public.attempt_finalize(bigint, text) from public, anon, authenticated;

-- ── the sittings already handed in ──────────────────────────────────────────
do $$
declare
  r record;
begin
  for r in select id from public.exam_attempts where status = 'submitted' order by id loop
    perform public.attempt_record_responses(r.id);
  end loop;
end;
$$;

-- ── "sualda səhv var" ───────────────────────────────────────────────────────
-- A student's report from the review, tied to the question and the sitting,
-- so the admin sees it next to the key and the choice distribution — the
-- two things that tell a wrong key from a hard question.
create table public.question_reports (
  id bigint generated always as identity primary key,
  question_id bigint references public.questions (id) on delete set null,
  user_id uuid not null references auth.users (id) on delete cascade,
  attempt_id bigint references public.exam_attempts (id) on delete set null,
  seq smallint,
  note text not null check (char_length(note) between 1 and 1000),
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null
);

create index question_reports_question_idx on public.question_reports (question_id, status);
create index question_reports_status_idx on public.question_reports (status, created_at desc);

alter table public.question_reports enable row level security;
create policy question_reports_admin_select on public.question_reports
  for select to authenticated using ((select public.is_admin()));
create policy question_reports_admin_update on public.question_reports
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
grant select, update on public.question_reports to authenticated;

create or replace function public.attempt_report(p_attempt_id bigint, p_seq integer, p_note text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  a public.exam_attempts;
  v_question bigint;
begin
  select * into a from public.exam_attempts
  where id = p_attempt_id and user_id = auth.uid() and status = 'submitted';
  if not found then
    raise exception 'Cəhd tapılmadı' using errcode = 'P0002';
  end if;
  select i.question_id into v_question
  from public.exam_version_items i
  where i.version_id = a.version_id and i.seq = p_seq;
  if not found then
    raise exception 'bad seq';
  end if;
  -- One open report per student per question of a sitting is enough.
  if exists (
    select 1 from public.question_reports
    where attempt_id = a.id and seq = p_seq and user_id = a.user_id and status = 'open'
  ) then
    return;
  end if;
  insert into public.question_reports (question_id, user_id, attempt_id, seq, note)
  values (v_question, a.user_id, a.id, p_seq, left(btrim(p_note), 1000));
end;
$$;

revoke all on function public.attempt_report(bigint, integer, text) from public, anon;
grant execute on function public.attempt_report(bigint, integer, text) to authenticated;

-- A student sitting a deneme: the attempt, its answers, its clock, its score.
--
-- Everything here is reached through `security definer` functions and
-- nothing else. The tables carry no policies at all: a student never
-- queries them, because the questions of the version an attempt is bound to
-- carry their answers, and a score is not the student's to write. Each
-- function names the caller with `auth.uid()` and refuses a row that is not
-- theirs.
--
-- An attempt binds to a VERSION, never to the exam. The questions a student
-- saw, the order they saw them in, and the rules they were scored by are
-- the version's, frozen at publish; the admin re-publishing tomorrow changes
-- nothing about an attempt made today. The exam id is carried too, for
-- lookups and for the one-open-attempt rule below.
--
-- THE CLOCK STOPS WHEN THE STUDENT LEAVES — a product decision (2026-09-24)
-- that rules out counting wall time. Time is counted in HEARTBEATS: the
-- browser reports in every fifteen seconds while the exam is on screen, each
-- report advances `time_used_seconds` by however long it has been since the
-- last one (capped, so a laptop closed mid-beat is not charged for the night),
-- and a tab that dies simply stops reporting. The server is the only clock;
-- what the browser shows is the remaining time the last call returned,
-- counted down locally between calls. When the server sees the time run out
-- it submits the attempt itself, from whatever was answered.
--
-- One OPEN attempt per student across every exam. Leaving is pausing, not
-- abandoning: a student comes back to the same attempt, and cannot start
-- another deneme until this one is handed in. That is the rule the product
-- owner asked for, and the partial unique index below is what enforces it —
-- two tabs racing to start cannot both win.

create table public.exam_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  exam_id bigint not null references public.exams (id) on delete cascade,
  version_id bigint not null references public.exam_versions (id) on delete cascade,
  -- 1 for the first sitting of this exam, 2 for a retake, and so on.
  attempt_no integer not null check (attempt_no > 0),
  status text not null default 'in_progress'
    check (status in ('in_progress', 'submitted')),
  started_at timestamptz not null default now(),
  -- Active time so far, advanced by heartbeats; the clock this attempt runs
  -- on. Never by wall time.
  time_used_seconds integer not null default 0 check (time_used_seconds >= 0),
  last_seen_at timestamptz not null default now(),
  -- Where they were, so resuming lands on the same question.
  current_seq smallint not null default 1,
  submitted_at timestamptz,
  -- Who handed it in: the student, or the clock.
  submitted_by text check (submitted_by in ('student', 'timeout')),
  score numeric(9, 4),
  max_score numeric(9, 4),
  correct_count smallint,
  wrong_count smallint,
  blank_count smallint,
  -- [{ position, subject_name, correct, wrong, blank, net, points, max }]
  section_scores jsonb,
  -- Set the first time the student opens the answer review. A retake after
  -- this is counted separately in analytics: the questions are no longer
  -- unseen.
  answers_revealed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, exam_id, attempt_no)
);

create unique index exam_attempts_one_open_idx
  on public.exam_attempts (user_id)
  where status = 'in_progress';
create index exam_attempts_user_exam_idx on public.exam_attempts (user_id, exam_id, attempt_no desc);
create index exam_attempts_version_idx on public.exam_attempts (version_id);

comment on table public.exam_attempts is
  'One sitting of a deneme, bound to the published version it was taken against. Reached only through the attempt_* functions.';

-- What the student answered, one row per question they touched. `choice`
-- null with a row present means "answered, then cleared"; no row means never
-- touched. Both are blanks for scoring, and the difference is analytics.
create table public.attempt_responses (
  attempt_id bigint not null references public.exam_attempts (id) on delete cascade,
  seq smallint not null,
  choice char(1) check (choice is null or choice in ('A', 'B', 'C', 'D', 'E')),
  flagged boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (attempt_id, seq)
);

-- The raw record of the sitting, for analytics that have not been designed
-- yet: which question was open when, every answer and every change of one,
-- every flag, every time the sketchpad opened, every pause and resume, the
-- hand-in. Written in batches from the browser, best effort — losing a
-- batch loses nothing a student can see. Read by nothing yet.
create table public.attempt_events (
  id bigint generated always as identity primary key,
  attempt_id bigint not null references public.exam_attempts (id) on delete cascade,
  seq smallint,
  kind text not null,
  payload jsonb,
  at timestamptz not null
);

create index attempt_events_attempt_idx on public.attempt_events (attempt_id, at);

-- What the student drew: the layer over the question, and the separate
-- board, per question. Vector objects as JSON, which is small, so it can be
-- kept — and it is what lets a tablet-started attempt continue on a phone.
create table public.attempt_sketches (
  attempt_id bigint not null references public.exam_attempts (id) on delete cascade,
  seq smallint not null,
  layer text not null check (layer in ('question', 'board')),
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (attempt_id, seq, layer)
);

alter table public.exam_attempts enable row level security;
alter table public.attempt_responses enable row level security;
alter table public.attempt_events enable row level security;
alter table public.attempt_sketches enable row level security;
-- No STUDENT policy on any of them, by design: see the top of this file.
-- Admins read them for analytics (next phase), and that is the only direct
-- read there is.
create policy exam_attempts_admin_select on public.exam_attempts
  for select to authenticated using ((select public.is_admin()));
create policy attempt_responses_admin_select on public.attempt_responses
  for select to authenticated using ((select public.is_admin()));
create policy attempt_events_admin_select on public.attempt_events
  for select to authenticated using ((select public.is_admin()));
create policy attempt_sketches_admin_select on public.attempt_sketches
  for select to authenticated using ((select public.is_admin()));
grant select on public.exam_attempts, public.attempt_responses,
  public.attempt_events, public.attempt_sketches to authenticated;

create trigger exam_attempts_set_updated_at
  before update on public.exam_attempts
  for each row execute function public.set_updated_at();

-- ── the clock ───────────────────────────────────────────────────────────────
-- A heartbeat is charged for the time since the last one, up to this many
-- seconds. The browser beats every 15; a gap longer than the cap means the
-- tab was not on screen, and that time was the student's pause.
create or replace function public.attempt_beat_cap_seconds()
returns integer
language sql
immutable
set search_path = ''
as $$ select 45 $$;

-- Charges the caller's open attempt for the time since it last reported,
-- and says how much is left. Submits it, from what was answered, when the
-- time is gone. Every function a student calls mid-exam goes through this,
-- so the clock is right whichever call came last.
create or replace function public.attempt_touch(p_attempt_id bigint)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  a public.exam_attempts;
  v_limit integer;
  v_gap integer;
  v_left integer;
begin
  select * into a from public.exam_attempts
  where id = p_attempt_id and user_id = auth.uid()
  for update;
  if not found then
    raise exception 'Cəhd tapılmadı' using errcode = 'P0002';
  end if;
  if a.status <> 'in_progress' then
    return 0;
  end if;

  select v.duration_seconds into v_limit from public.exam_versions v where v.id = a.version_id;

  v_gap := least(
    greatest(0, extract(epoch from (now() - a.last_seen_at))::integer),
    public.attempt_beat_cap_seconds()
  );

  update public.exam_attempts
  set time_used_seconds = least(v_limit, time_used_seconds + v_gap),
      last_seen_at = now()
  where id = a.id
  returning time_used_seconds into a.time_used_seconds;

  v_left := v_limit - a.time_used_seconds;
  if v_left <= 0 then
    perform public.attempt_finalize(a.id, 'timeout');
    return 0;
  end if;
  return v_left;
end;
$$;

-- ── scoring ─────────────────────────────────────────────────────────────────
-- Scored by the RULES THE VERSION CARRIES, never by the template: per section,
-- net = correct − wrong × penalty, floored at zero so one subject's wrong
-- answers never eat another's points, times the section's points; the base
-- on top; the minimum as a floor. A blank costs nothing. Shared by the
-- student's hand-in and by the clock's, so both are scored by one rule.
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
end;
$$;

revoke all on function public.attempt_finalize(bigint, text) from public, anon, authenticated;
revoke all on function public.attempt_beat_cap_seconds() from public, anon;

-- ── what the browser is handed ──────────────────────────────────────────────
-- The attempt as the exam screen needs it: the questions of its version
-- WITHOUT their answers, the responses so far, and the clock.
create or replace function public.attempt_payload(p_attempt_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a public.exam_attempts;
  v public.exam_versions;
  e public.exams;
  v_left integer;
begin
  select * into a from public.exam_attempts where id = p_attempt_id and user_id = auth.uid();
  if not found then
    raise exception 'Cəhd tapılmadı' using errcode = 'P0002';
  end if;
  select * into v from public.exam_versions where id = a.version_id;
  select * into e from public.exams where id = a.exam_id;
  v_left := greatest(0, v.duration_seconds - a.time_used_seconds);

  return jsonb_build_object(
    'attempt', jsonb_build_object(
      'id', a.id,
      'exam_id', a.exam_id,
      'title', e.title,
      'attempt_no', a.attempt_no,
      'status', a.status,
      'current_seq', a.current_seq,
      'remaining_seconds', v_left,
      'duration_seconds', v.duration_seconds,
      'question_count', v.question_count,
      'max_score', v.max_score,
      'navigation', v.rules ->> 'navigation',
      'sections', (
        select jsonb_agg(
          jsonb_build_object(
            'position', (s ->> 'position')::integer,
            'subject_name', s ->> 'subject_name',
            'question_count', (s ->> 'question_count')::integer
          )
          order by (s ->> 'position')::integer
        )
        from jsonb_array_elements(v.rules -> 'sections') as s
      )
    ),
    'questions', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'seq', i.seq,
          'section_position', i.section_position,
          'stem', i.stem,
          'options', i.options,
          'figures', i.figures
        )
        order by i.seq
      ), '[]'::jsonb)
      from public.exam_version_items i
      where i.version_id = a.version_id
    ),
    'responses', (
      select coalesce(jsonb_object_agg(
        r.seq::text,
        jsonb_build_object('choice', r.choice, 'flagged', r.flagged)
      ), '{}'::jsonb)
      from public.attempt_responses r
      where r.attempt_id = a.id
    )
  );
end;
$$;

revoke all on function public.attempt_payload(bigint) from public, anon, authenticated;

-- ── start, or come back ─────────────────────────────────────────────────────
-- Starting an exam the student already has open RESUMES it. Starting a
-- different exam while one is open is refused with the open one named, so
-- the screen can send them there. A finished exam can be sat again — a new
-- attempt, numbered on from the last — only if its version allows retakes.
create or replace function public.attempt_start(p_exam_id bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_open public.exam_attempts;
  e public.exams;
  v public.exam_versions;
  v_no integer;
  v_id bigint;
begin
  if v_user is null then
    raise exception 'not signed in';
  end if;

  select * into v_open from public.exam_attempts
  where user_id = v_user and status = 'in_progress';
  if found then
    if v_open.exam_id = p_exam_id then
      perform public.attempt_touch(v_open.id);
      update public.exam_attempts set last_seen_at = now() where id = v_open.id;
      insert into public.attempt_events (attempt_id, seq, kind, at)
      values (v_open.id, v_open.current_seq, 'resume', now());
      return public.attempt_payload(v_open.id);
    end if;
    raise exception 'open_attempt:%', v_open.exam_id using errcode = 'P0001';
  end if;

  select * into e from public.exams
  where id = p_exam_id and is_visible and access_rule is null and current_version_id is not null;
  if not found then
    raise exception 'Deneme tapılmadı' using errcode = 'P0002';
  end if;
  select * into v from public.exam_versions where id = e.current_version_id;

  select coalesce(max(attempt_no), 0) + 1 into v_no
  from public.exam_attempts where user_id = v_user and exam_id = p_exam_id;
  if v_no > 1 and not coalesce((v.rules ->> 'allow_retake')::boolean, true) then
    raise exception 'Bu deneme bir dəfə işlənə bilər';
  end if;

  insert into public.exam_attempts (user_id, exam_id, version_id, attempt_no)
  values (v_user, p_exam_id, v.id, v_no)
  returning id into v_id;

  insert into public.attempt_events (attempt_id, seq, kind, at)
  values (v_id, 1, 'start', now());

  return public.attempt_payload(v_id);
end;
$$;

-- The open attempt, if any — what the list and the guard ask.
create or replace function public.attempt_current()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_open public.exam_attempts;
begin
  select * into v_open from public.exam_attempts
  where user_id = auth.uid() and status = 'in_progress';
  if not found then
    return null;
  end if;
  -- The clock may have run out while nobody was looking.
  perform public.attempt_touch(v_open.id);
  select * into v_open from public.exam_attempts where id = v_open.id;
  if v_open.status <> 'in_progress' then
    return null;
  end if;
  return public.attempt_payload(v_open.id);
end;
$$;

-- ── during the exam ─────────────────────────────────────────────────────────
create or replace function public.attempt_answer(
  p_attempt_id bigint,
  p_seq integer,
  p_choice text,
  p_flagged boolean default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_left integer;
  v_prev char(1);
begin
  v_left := public.attempt_touch(p_attempt_id);
  if v_left <= 0 then
    return 0;
  end if;
  if p_choice is not null and p_choice not in ('A', 'B', 'C', 'D', 'E') then
    raise exception 'bad choice';
  end if;
  if not exists (
    select 1 from public.exam_version_items i
    join public.exam_attempts a on a.version_id = i.version_id
    where a.id = p_attempt_id and i.seq = p_seq
  ) then
    raise exception 'bad seq';
  end if;

  select choice into v_prev from public.attempt_responses
  where attempt_id = p_attempt_id and seq = p_seq;

  insert into public.attempt_responses (attempt_id, seq, choice, flagged)
  values (p_attempt_id, p_seq, p_choice, coalesce(p_flagged, false))
  on conflict (attempt_id, seq) do update
    set choice = excluded.choice,
        flagged = coalesce(p_flagged, public.attempt_responses.flagged),
        updated_at = now();

  update public.exam_attempts set current_seq = p_seq where id = p_attempt_id;

  insert into public.attempt_events (attempt_id, seq, kind, payload, at)
  values (
    p_attempt_id, p_seq,
    case when p_choice is null then 'clear' when v_prev is null then 'answer' else 'change' end,
    jsonb_build_object('from', v_prev, 'to', p_choice),
    now()
  );
  return v_left;
end;
$$;

create or replace function public.attempt_flag(p_attempt_id bigint, p_seq integer, p_flagged boolean)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_left integer;
begin
  v_left := public.attempt_touch(p_attempt_id);
  if v_left <= 0 then
    return 0;
  end if;
  insert into public.attempt_responses (attempt_id, seq, choice, flagged)
  values (p_attempt_id, p_seq, null, p_flagged)
  on conflict (attempt_id, seq) do update
    set flagged = excluded.flagged, updated_at = now();
  insert into public.attempt_events (attempt_id, seq, kind, at)
  values (p_attempt_id, p_seq, case when p_flagged then 'flag' else 'unflag' end, now());
  return v_left;
end;
$$;

-- The beat: "still here, on question N". Returns the seconds left.
create or replace function public.attempt_heartbeat(p_attempt_id bigint, p_seq integer default null)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_left integer;
begin
  v_left := public.attempt_touch(p_attempt_id);
  if p_seq is not null and v_left > 0 then
    update public.exam_attempts set current_seq = p_seq where id = p_attempt_id;
  end if;
  return v_left;
end;
$$;

-- Leaving: charge up to now, then stop the clock by not reporting. The
-- event is what analytics needs; the pause itself needs no state, because
-- the next beat only ever charges the capped gap since the last.
create or replace function public.attempt_pause(p_attempt_id bigint, p_seq integer default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform public.attempt_touch(p_attempt_id);
  if p_seq is not null then
    update public.exam_attempts set current_seq = p_seq
    where id = p_attempt_id and user_id = auth.uid() and status = 'in_progress';
  end if;
  insert into public.attempt_events (attempt_id, seq, kind, at)
  select p_attempt_id, p_seq, 'pause', now()
  from public.exam_attempts where id = p_attempt_id and user_id = auth.uid();
end;
$$;

-- Batches of the raw log. Best effort from the browser; nothing a student
-- sees depends on it.
create or replace function public.attempt_events_add(p_attempt_id bigint, p_events jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.exam_attempts where id = p_attempt_id and user_id = auth.uid()) then
    raise exception 'Cəhd tapılmadı' using errcode = 'P0002';
  end if;
  insert into public.attempt_events (attempt_id, seq, kind, payload, at)
  select
    p_attempt_id,
    (e ->> 'seq')::smallint,
    left(e ->> 'kind', 40),
    e -> 'payload',
    coalesce((e ->> 'at')::timestamptz, now())
  from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) as e
  where e ? 'kind';
end;
$$;

create or replace function public.attempt_sketch_save(
  p_attempt_id bigint,
  p_seq integer,
  p_layer text,
  p_data jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.exam_attempts where id = p_attempt_id and user_id = auth.uid()) then
    raise exception 'Cəhd tapılmadı' using errcode = 'P0002';
  end if;
  insert into public.attempt_sketches (attempt_id, seq, layer, data)
  values (p_attempt_id, p_seq, p_layer, p_data)
  on conflict (attempt_id, seq, layer) do update
    set data = excluded.data, updated_at = now();
end;
$$;

create or replace function public.attempt_sketches_load(p_attempt_id bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('seq', s.seq, 'layer', s.layer, 'data', s.data)), '[]'::jsonb)
  from public.attempt_sketches s
  join public.exam_attempts a on a.id = s.attempt_id
  where s.attempt_id = p_attempt_id and a.user_id = auth.uid();
$$;

-- ── handing in ──────────────────────────────────────────────────────────────
create or replace function public.attempt_submit(p_attempt_id bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.exam_attempts where id = p_attempt_id and user_id = auth.uid()) then
    raise exception 'Cəhd tapılmadı' using errcode = 'P0002';
  end if;
  perform public.attempt_touch(p_attempt_id);
  perform public.attempt_finalize(p_attempt_id, 'student');
  return public.attempt_result(p_attempt_id);
end;
$$;

-- ── the result ──────────────────────────────────────────────────────────────
-- Score and counts, per section. The questions and the answers are a
-- separate call, because the review screen is its own decision.
create or replace function public.attempt_result(p_attempt_id bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', a.id,
    'exam_id', a.exam_id,
    'title', e.title,
    'attempt_no', a.attempt_no,
    'status', a.status,
    'submitted_at', a.submitted_at,
    'submitted_by', a.submitted_by,
    'time_used_seconds', a.time_used_seconds,
    'duration_seconds', v.duration_seconds,
    'score', a.score,
    'max_score', a.max_score,
    'correct', a.correct_count,
    'wrong', a.wrong_count,
    'blank', a.blank_count,
    'sections', a.section_scores,
    'reveal_answers', v.rules ->> 'reveal_answers'
  )
  from public.exam_attempts a
  join public.exam_versions v on v.id = a.version_id
  join public.exams e on e.id = a.exam_id
  where a.id = p_attempt_id and a.user_id = auth.uid() and a.status = 'submitted';
$$;

-- ── the list, now with where the student stands ─────────────────────────────
-- Replaced rather than altered: the return type grows, which `create or
-- replace` cannot do.
drop function if exists public.student_exams();
create function public.student_exams()
returns table (
  id bigint,
  seq integer,
  title text,
  program_name text,
  template_name text,
  version_no integer,
  question_count smallint,
  duration_seconds integer,
  max_score numeric,
  sections jsonb,
  published_at timestamptz,
  status text,
  answered integer,
  correct integer,
  score numeric,
  attempt_id bigint,
  attempt_count integer,
  best_score numeric
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  -- An open attempt whose clock ran out while nobody was looking is settled
  -- before the list is read, so it never shows as "in progress" for good.
  perform public.attempt_current();

  return query
  select
    e.id,
    e.seq,
    e.title,
    p.name,
    v.rules ->> 'template_name',
    v.version_no,
    v.question_count,
    v.duration_seconds,
    v.max_score,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'subject_name', s ->> 'subject_name',
            'question_count', (s ->> 'question_count')::integer
          )
          order by (s ->> 'position')::integer
        )
        from jsonb_array_elements(v.rules -> 'sections') as s
      ),
      '[]'::jsonb
    ),
    v.published_at,
    case
      when la.status = 'in_progress' then 'in_progress'
      when la.status = 'submitted' then 'completed'
      else 'not_started'
    end,
    case when la.status = 'in_progress' then (
      select count(*)::integer from public.attempt_responses r
      where r.attempt_id = la.id and r.choice is not null
    ) end,
    case when la.status = 'submitted' then la.correct_count::integer end,
    case when la.status = 'submitted' then la.score end,
    la.id,
    (select count(*)::integer from public.exam_attempts x
      where x.user_id = auth.uid() and x.exam_id = e.id and x.status = 'submitted'),
    (select max(x.score) from public.exam_attempts x
      where x.user_id = auth.uid() and x.exam_id = e.id and x.status = 'submitted')
  from public.exams e
  join public.exam_versions v on v.id = e.current_version_id
  join public.programs p on p.id = e.program_id
  left join lateral (
    select * from public.exam_attempts x
    where x.user_id = auth.uid() and x.exam_id = e.id
    order by x.attempt_no desc
    limit 1
  ) la on true
  where e.is_visible
    and e.access_rule is null
    and auth.uid() is not null
  order by e.seq;
end;
$$;

-- ── grants ──────────────────────────────────────────────────────────────────
revoke all on function public.attempt_touch(bigint) from public, anon;
revoke all on function public.attempt_payload(bigint) from public, anon;
revoke all on function public.attempt_start(bigint) from public, anon;
revoke all on function public.attempt_current() from public, anon;
revoke all on function public.attempt_answer(bigint, integer, text, boolean) from public, anon;
revoke all on function public.attempt_flag(bigint, integer, boolean) from public, anon;
revoke all on function public.attempt_heartbeat(bigint, integer) from public, anon;
revoke all on function public.attempt_pause(bigint, integer) from public, anon;
revoke all on function public.attempt_events_add(bigint, jsonb) from public, anon;
revoke all on function public.attempt_sketch_save(bigint, integer, text, jsonb) from public, anon;
revoke all on function public.attempt_sketches_load(bigint) from public, anon;
revoke all on function public.attempt_submit(bigint) from public, anon;
revoke all on function public.attempt_result(bigint) from public, anon;
revoke all on function public.student_exams() from public, anon;

-- `attempt_touch` and `attempt_payload` are internal, reached only through
-- the functions above.
revoke all on function public.attempt_touch(bigint) from authenticated;
revoke all on function public.attempt_payload(bigint) from authenticated;

grant execute on function public.attempt_start(bigint) to authenticated;
grant execute on function public.attempt_current() to authenticated;
grant execute on function public.attempt_answer(bigint, integer, text, boolean) to authenticated;
grant execute on function public.attempt_flag(bigint, integer, boolean) to authenticated;
grant execute on function public.attempt_heartbeat(bigint, integer) to authenticated;
grant execute on function public.attempt_pause(bigint, integer) to authenticated;
grant execute on function public.attempt_events_add(bigint, jsonb) to authenticated;
grant execute on function public.attempt_sketch_save(bigint, integer, text, jsonb) to authenticated;
grant execute on function public.attempt_sketches_load(bigint) to authenticated;
grant execute on function public.attempt_submit(bigint) to authenticated;
grant execute on function public.attempt_result(bigint) to authenticated;
grant execute on function public.student_exams() to authenticated;

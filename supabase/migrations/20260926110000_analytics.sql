-- Analytics, read from the fact table by admins only.
--
-- Every function here is `security definer` so it can read across students,
-- and every one begins by refusing a caller who is not an admin. They are
-- STABLE: pure reads, computed on request — the numbers are small enough
-- (thousands of sittings, not millions) that no materialisation is needed
-- yet, and a view that is always fresh beats one that is sometimes stale.
--
-- Vocabulary used throughout:
--   correct_pct / blank_pct / wrong_pct — shares of all responses (0–100).
--   suspicious — the key may be wrong: at least 10 sittings, under a
--     quarter correct, and one OTHER option chosen by at least half of
--     those who answered. A hard question is not chosen the same wrong way
--     by half the room.
--   discrimination — correct share among the strongest sittings of that
--     deneme (top 27% by score) minus the weakest (bottom 27%). Near zero
--     or negative means the question does not tell strong from weak.

create or replace function public.analytics_guard()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select public.is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.analytics_guard() from public, anon, authenticated;

-- ── the overview block on İcmal ─────────────────────────────────────────────
create or replace function public.analytics_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  out jsonb;
begin
  perform public.analytics_guard();
  select jsonb_build_object(
    'students_total', (select count(*) from public.profiles p where p.onboarded_at is not null),
    'students_active_7d', (
      select count(distinct a.user_id) from public.exam_attempts a
      where a.last_seen_at >= now() - interval '7 days'
    ),
    'attempts_total', (select count(*) from public.exam_attempts where status = 'submitted'),
    'attempts_7d', (
      select count(*) from public.exam_attempts
      where status = 'submitted' and submitted_at >= now() - interval '7 days'
    ),
    'responses_total', (select count(*) from public.question_responses),
    'accuracy_pct', (
      select round(100.0 * count(*) filter (where is_correct) / nullif(count(*) filter (where not is_blank), 0), 1)
      from public.question_responses
    ),
    'blank_pct', (
      select round(100.0 * count(*) filter (where is_blank) / nullif(count(*), 0), 1)
      from public.question_responses
    ),
    'avg_score_pct', (
      select round(avg(100.0 * score / nullif(max_score, 0)), 1)
      from public.exam_attempts where status = 'submitted'
    ),
    'weak_topics', (
      select coalesce(jsonb_agg(t order by t.miss_pct desc), '[]'::jsonb)
      from (
        select c.id as category_id, c.name, s.name as subject_name,
          count(*) as responses,
          round(100.0 * count(*) filter (where not r.is_correct) / count(*), 1) as miss_pct
        from public.question_responses r
        join public.categories c on c.id = r.category_id
        join public.subjects s on s.id = c.subject_id
        group by c.id, c.name, s.name
        having count(*) >= 20
        order by miss_pct desc
        limit 5
      ) t
    ),
    'suspicious_questions', (
      select count(*) from public.analytics_question_stats(null::bigint[]) q where q.suspicious
    ),
    'open_reports', (select count(*) from public.question_reports where status = 'open')
  ) into out;
  return out;
end;
$$;
revoke all on function public.analytics_overview() from public, anon;
grant execute on function public.analytics_overview() to authenticated;

-- ── per question, for a list (null = every question with responses) ────────
create or replace function public.analytics_question_stats(p_question_ids bigint[])
returns table (
  question_id bigint,
  responses bigint,
  correct_pct numeric,
  blank_pct numeric,
  wrong_pct numeric,
  avg_time numeric,
  suspicious boolean,
  open_reports bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.analytics_guard();
  return query
  with base as (
    select r.question_id, r.choice, r.answer, r.is_correct, r.is_blank, r.time_seconds
    from public.question_responses r
    where r.question_id is not null
      and (p_question_ids is null or r.question_id = any (p_question_ids))
  ),
  per_choice as (
    select b.question_id, b.choice, count(*) as n
    from base b where b.choice is not null
    group by b.question_id, b.choice
  ),
  agg as (
    select
      b.question_id,
      count(*) as responses,
      count(*) filter (where b.is_correct) as correct_n,
      count(*) filter (where b.is_blank) as blank_n,
      count(*) filter (where not b.is_blank) as answered_n,
      avg(b.time_seconds) as avg_time,
      max(b.answer) as answer
    from base b group by b.question_id
  )
  select
    a.question_id,
    a.responses,
    round(100.0 * a.correct_n / a.responses, 1),
    round(100.0 * a.blank_n / a.responses, 1),
    round(100.0 * (a.responses - a.correct_n - a.blank_n) / a.responses, 1),
    round(a.avg_time, 0),
    a.responses >= 10
      and a.correct_n < a.answered_n * 0.25
      and exists (
        select 1 from per_choice pc
        where pc.question_id = a.question_id and pc.choice <> a.answer
          and pc.n >= a.answered_n * 0.5
      ),
    (select count(*) from public.question_reports qr
      where qr.question_id = a.question_id and qr.status = 'open')
  from agg a;
end;
$$;
revoke all on function public.analytics_question_stats(bigint[]) from public, anon;
grant execute on function public.analytics_question_stats(bigint[]) to authenticated;

-- ── one question, across every context ──────────────────────────────────────
create or replace function public.analytics_question(p_question_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  out jsonb;
begin
  perform public.analytics_guard();
  with base as (
    select r.* from public.question_responses r where r.question_id = p_question_id
  ),
  ranked as (
    -- Where each deneme sitting stood among the sittings of the same exam.
    select a.id as attempt_id,
      percent_rank() over (partition by a.exam_id order by a.score / nullif(a.max_score, 0)) as pr
    from public.exam_attempts a where a.status = 'submitted'
  ),
  disc as (
    select
      avg(case when b.is_correct then 1.0 else 0 end) filter (where k.pr >= 0.73) as top_rate,
      avg(case when b.is_correct then 1.0 else 0 end) filter (where k.pr <= 0.27) as bottom_rate,
      count(*) filter (where k.pr >= 0.73) as top_n,
      count(*) filter (where k.pr <= 0.27) as bottom_n
    from base b join ranked k on k.attempt_id = b.context_attempt_id
    where b.context_kind = 'deneme'
  )
  select jsonb_build_object(
    'question_id', p_question_id,
    'responses', (select count(*) from base),
    'students', (select count(distinct user_id) from base),
    'correct_pct', (select round(100.0 * count(*) filter (where is_correct) / nullif(count(*), 0), 1) from base),
    'blank_pct', (select round(100.0 * count(*) filter (where is_blank) / nullif(count(*), 0), 1) from base),
    'wrong_pct', (select round(100.0 * count(*) filter (where not is_correct and not is_blank) / nullif(count(*), 0), 1) from base),
    'avg_time', (select round(avg(time_seconds), 0) from base),
    'median_time', (select percentile_cont(0.5) within group (order by time_seconds) from base where time_seconds is not null),
    'board_pct', (select round(100.0 * count(*) filter (where board_used) / nullif(count(*), 0), 1) from base),
    'avg_changes', (select round(avg(change_count), 2) from base),
    'answer', (select max(answer) from base),
    'choices', (
      select coalesce(jsonb_object_agg(c.label, c.n), '{}'::jsonb) from (
        select coalesce(choice, '-') as label, count(*) as n from base group by coalesce(choice, '-')
      ) c
    ),
    'discrimination', (
      select case when top_n >= 5 and bottom_n >= 5 then round(top_rate - bottom_rate, 2) end from disc
    ),
    'suspicious', (select coalesce(bool_or(q.suspicious), false) from public.analytics_question_stats(array[p_question_id]) q),
    'by_context_kind', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select context_kind, count(*) as responses,
          round(100.0 * count(*) filter (where is_correct) / count(*), 1) as correct_pct,
          round(100.0 * count(*) filter (where is_blank) / count(*), 1) as blank_pct,
          round(avg(time_seconds), 0) as avg_time
        from base group by context_kind order by context_kind
      ) t
    ),
    'by_context', (
      select coalesce(jsonb_agg(t order by t.responses desc), '[]'::jsonb) from (
        select b.context_kind, b.context_id, e.title, count(*) as responses,
          round(100.0 * count(*) filter (where b.is_correct) / count(*), 1) as correct_pct,
          round(100.0 * count(*) filter (where b.is_blank) / count(*), 1) as blank_pct,
          round(avg(b.time_seconds), 0) as avg_time
        from base b
        left join public.exams e on b.context_kind = 'deneme' and e.id = b.context_id
        group by b.context_kind, b.context_id, e.title
      ) t
    ),
    'reports', (
      select coalesce(jsonb_agg(t order by t.created_at desc), '[]'::jsonb) from (
        select qr.id, qr.note, qr.status, qr.created_at, qr.attempt_id, qr.seq,
          p.full_name as student_name
        from public.question_reports qr
        left join public.profiles p on p.id = qr.user_id
        where qr.question_id = p_question_id
        limit 50
      ) t
    )
  ) into out;
  return out;
end;
$$;
revoke all on function public.analytics_question(bigint) from public, anon;
grant execute on function public.analytics_question(bigint) to authenticated;

-- ── the TR-YÖS denemeler, side by side ──────────────────────────────────────
create or replace function public.analytics_denemeler()
returns table (
  exam_id bigint,
  title text,
  seq integer,
  kind text,
  question_count smallint,
  attempts bigint,
  students bigint,
  avg_score numeric,
  median_score numeric,
  max_score numeric,
  avg_pct numeric,
  avg_time_seconds numeric,
  timeout_pct numeric,
  retake_pct numeric,
  blank_pct numeric,
  last_attempt_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.analytics_guard();
  return query
  select
    e.id, e.title, e.seq,
    coalesce(v.rules ->> 'template_name', s.name),
    v.question_count,
    count(a.id),
    count(distinct a.user_id),
    round(avg(a.score), 2),
    round((percentile_cont(0.5) within group (order by a.score))::numeric, 2),
    v.max_score,
    round(avg(100.0 * a.score / nullif(a.max_score, 0)), 1),
    round(avg(a.time_used_seconds), 0),
    round(100.0 * count(a.id) filter (where a.submitted_by = 'timeout') / nullif(count(a.id), 0), 1),
    round(100.0 * count(a.id) filter (where a.attempt_no > 1) / nullif(count(a.id), 0), 1),
    round(100.0 * sum(a.blank_count) / nullif(sum(a.correct_count + a.wrong_count + a.blank_count), 0), 1),
    max(a.submitted_at)
  from public.exams e
  join public.exam_versions v on v.id = e.current_version_id
  left join public.subjects s on s.id = (
    select (x ->> 'subject_id')::bigint from jsonb_array_elements(v.rules -> 'sections') x
    where jsonb_array_length(v.rules -> 'sections') = 1 limit 1
  )
  left join public.exam_attempts a on a.exam_id = e.id and a.status = 'submitted'
  where e.current_version_id is not null
  group by e.id, e.title, e.seq, v.rules, v.question_count, v.max_score, s.name
  order by e.seq;
end;
$$;
revoke all on function public.analytics_denemeler() from public, anon;
grant execute on function public.analytics_denemeler() to authenticated;

-- ── one deneme in depth ─────────────────────────────────────────────────────
create or replace function public.analytics_deneme(p_exam_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  out jsonb;
begin
  perform public.analytics_guard();
  with att as (
    select a.* from public.exam_attempts a where a.exam_id = p_exam_id and a.status = 'submitted'
  ),
  ranked as (
    select a.id as attempt_id,
      percent_rank() over (order by a.score / nullif(a.max_score, 0)) as pr
    from att a
  ),
  resp as (
    select r.* from public.question_responses r
    where r.context_kind = 'deneme' and r.context_id = p_exam_id
  ),
  items as (
    select r.context_seq as seq, max(r.question_id) as question_id,
      max(r.category_id) as category_id, max(r.difficulty) as difficulty, max(r.answer) as answer,
      count(*) as responses,
      round(100.0 * count(*) filter (where r.is_correct) / count(*), 1) as correct_pct,
      round(100.0 * count(*) filter (where r.is_blank) / count(*), 1) as blank_pct,
      round(100.0 * count(*) filter (where not r.is_correct and not r.is_blank) / count(*), 1) as wrong_pct,
      round(avg(r.time_seconds), 0) as avg_time,
      round(100.0 * count(*) filter (where r.board_used) / count(*), 1) as board_pct,
      round(avg(r.change_count), 2) as avg_changes,
      (select jsonb_object_agg(c.label, c.n) from (
        select coalesce(x.choice, '-') as label, count(*) as n
        from resp x where x.context_seq = r.context_seq group by coalesce(x.choice, '-')
      ) c) as choices,
      (select case when count(*) filter (where k.pr >= 0.73) >= 5 and count(*) filter (where k.pr <= 0.27) >= 5
        then round(
          avg(case when x.is_correct then 1.0 else 0 end) filter (where k.pr >= 0.73)
          - avg(case when x.is_correct then 1.0 else 0 end) filter (where k.pr <= 0.27), 2) end
       from resp x join ranked k on k.attempt_id = x.context_attempt_id
       where x.context_seq = r.context_seq) as discrimination
    from resp r
    group by r.context_seq
  )
  select jsonb_build_object(
    'exam_id', p_exam_id,
    'attempts', (select count(*) from att),
    'students', (select count(distinct user_id) from att),
    'avg_score', (select round(avg(score), 2) from att),
    'median_score', (select round((percentile_cont(0.5) within group (order by score))::numeric, 2) from att),
    'max_score', (select max(max_score) from att),
    'avg_pct', (select round(avg(100.0 * score / nullif(max_score, 0)), 1) from att),
    'avg_time_seconds', (select round(avg(time_used_seconds), 0) from att),
    'timeout_pct', (select round(100.0 * count(*) filter (where submitted_by = 'timeout') / nullif(count(*), 0), 1) from att),
    'retake_pct', (select round(100.0 * count(*) filter (where attempt_no > 1) / nullif(count(*), 0), 1) from att),
    'reviewed_pct', (select round(100.0 * count(*) filter (where answers_revealed_at is not null) / nullif(count(*), 0), 1) from att),
    'histogram', (
      -- Ten bins of the score share, 0–10 … 90–100; the last bin takes 100.
      select coalesce(jsonb_agg(h order by h.bin), '[]'::jsonb) from (
        select g.bin, count(a.id) as n
        from generate_series(0, 9) as g(bin)
        left join att a on least(9, floor(10 * a.score / nullif(a.max_score, 0))) = g.bin
        group by g.bin
      ) h
    ),
    'sections', (
      select coalesce(jsonb_agg(t order by t.position), '[]'::jsonb) from (
        select (s ->> 'position')::integer as position, s ->> 'subject_name' as subject_name,
          round(avg((s ->> 'net')::numeric), 2) as avg_net,
          round(avg((s ->> 'points')::numeric), 2) as avg_points,
          max((s ->> 'max')::numeric) as max_points,
          round(avg((s ->> 'correct')::numeric), 1) as avg_correct,
          round(avg((s ->> 'wrong')::numeric), 1) as avg_wrong,
          round(avg((s ->> 'blank')::numeric), 1) as avg_blank
        from att a, jsonb_array_elements(a.section_scores) s
        group by (s ->> 'position')::integer, s ->> 'subject_name'
      ) t
    ),
    'by_day', (
      select coalesce(jsonb_agg(t order by t.day), '[]'::jsonb) from (
        select date_trunc('day', submitted_at)::date as day, count(*) as n,
          round(avg(100.0 * score / nullif(max_score, 0)), 1) as avg_pct
        from att group by 1
      ) t
    ),
    'items', (
      select coalesce(jsonb_agg(i order by i.seq), '[]'::jsonb) from (
        select it.*,
          it.responses >= 10 and it.correct_pct < 25 and exists (
            select 1 from jsonb_each_text(it.choices) c
            where c.key <> it.answer and c.key <> '-'
              and c.value::numeric >= 0.5 * (it.responses * (100 - it.blank_pct) / 100.0)
          ) as suspicious,
          (select count(*) from public.question_reports qr
            where qr.question_id = it.question_id and qr.status = 'open') as open_reports,
          cat.name as category_name
        from items it
        left join public.categories cat on cat.id = it.category_id
      ) i
    )
  ) into out;
  return out;
end;
$$;
revoke all on function public.analytics_deneme(bigint) from public, anon;
grant execute on function public.analytics_deneme(bigint) to authenticated;

-- ── topics ──────────────────────────────────────────────────────────────────
create or replace function public.analytics_topics(p_subject_id bigint default null)
returns table (
  category_id bigint,
  category_name text,
  subject_id bigint,
  subject_name text,
  questions bigint,
  responses bigint,
  correct_pct numeric,
  blank_pct numeric,
  wrong_pct numeric,
  avg_time numeric,
  avg_difficulty numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.analytics_guard();
  return query
  select
    c.id, c.name, s.id, s.name,
    count(distinct r.question_id),
    count(*),
    round(100.0 * count(*) filter (where r.is_correct) / count(*), 1),
    round(100.0 * count(*) filter (where r.is_blank) / count(*), 1),
    round(100.0 * count(*) filter (where not r.is_correct and not r.is_blank) / count(*), 1),
    round(avg(r.time_seconds), 0),
    round(avg(r.difficulty), 2)
  from public.question_responses r
  join public.categories c on c.id = r.category_id
  join public.subjects s on s.id = c.subject_id
  where p_subject_id is null or s.id = p_subject_id
  group by c.id, c.name, s.id, s.name
  order by s.name, c.name;
end;
$$;
revoke all on function public.analytics_topics(bigint) from public, anon;
grant execute on function public.analytics_topics(bigint) to authenticated;

-- ── sittings, as a list ─────────────────────────────────────────────────────
create or replace function public.analytics_attempts(
  p_exam_id bigint default null,
  p_user_id uuid default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  attempt_id bigint,
  user_id uuid,
  student_name text,
  exam_id bigint,
  exam_title text,
  attempt_no integer,
  score numeric,
  max_score numeric,
  correct_count smallint,
  wrong_count smallint,
  blank_count smallint,
  time_used_seconds integer,
  submitted_by text,
  submitted_at timestamptz,
  reviewed boolean,
  total bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.analytics_guard();
  return query
  select
    a.id, a.user_id, p.full_name, a.exam_id, e.title, a.attempt_no,
    a.score, a.max_score, a.correct_count, a.wrong_count, a.blank_count,
    a.time_used_seconds, a.submitted_by, a.submitted_at,
    a.answers_revealed_at is not null,
    count(*) over ()
  from public.exam_attempts a
  join public.exams e on e.id = a.exam_id
  left join public.profiles p on p.id = a.user_id
  where a.status = 'submitted'
    and (p_exam_id is null or a.exam_id = p_exam_id)
    and (p_user_id is null or a.user_id = p_user_id)
  order by a.submitted_at desc
  limit greatest(1, least(p_limit, 200)) offset greatest(0, p_offset);
end;
$$;
revoke all on function public.analytics_attempts(bigint, uuid, integer, integer) from public, anon;
grant execute on function public.analytics_attempts(bigint, uuid, integer, integer) to authenticated;

-- ── one student ─────────────────────────────────────────────────────────────
create or replace function public.analytics_student(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  out jsonb;
begin
  perform public.analytics_guard();
  with resp as (
    select r.* from public.question_responses r where r.user_id = p_user_id
  )
  select jsonb_build_object(
    'profile', (
      select jsonb_build_object(
        'id', p.id, 'full_name', p.full_name, 'goal_score', p.goal_score, 'grade', p.grade,
        'level', p.level, 'placement_at', p.placement_at, 'created_at', p.created_at
      ) from public.profiles p where p.id = p_user_id
    ),
    'attempts', (
      select coalesce(jsonb_agg(t order by t.submitted_at), '[]'::jsonb) from (
        select a.id, a.exam_id, e.title, a.attempt_no, a.score, a.max_score,
          a.correct_count, a.wrong_count, a.blank_count, a.time_used_seconds,
          a.submitted_by, a.submitted_at, a.answers_revealed_at is not null as reviewed
        from public.exam_attempts a join public.exams e on e.id = a.exam_id
        where a.user_id = p_user_id and a.status = 'submitted'
      ) t
    ),
    'responses', (select count(*) from resp),
    'accuracy_pct', (select round(100.0 * count(*) filter (where is_correct) / nullif(count(*) filter (where not is_blank), 0), 1) from resp),
    'blank_pct', (select round(100.0 * count(*) filter (where is_blank) / nullif(count(*), 0), 1) from resp),
    'wrong_pct', (select round(100.0 * count(*) filter (where not is_correct and not is_blank) / nullif(count(*), 0), 1) from resp),
    'avg_time', (select round(avg(time_seconds), 0) from resp),
    'topics', (
      select coalesce(jsonb_agg(t order by t.correct_pct), '[]'::jsonb) from (
        select c.id as category_id, c.name, s.name as subject_name, count(*) as responses,
          round(100.0 * count(*) filter (where r.is_correct) / count(*), 1) as correct_pct,
          round(100.0 * count(*) filter (where r.is_blank) / count(*), 1) as blank_pct
        from resp r join public.categories c on c.id = r.category_id
        join public.subjects s on s.id = c.subject_id
        group by c.id, c.name, s.name
        having count(*) >= 3
      ) t
    )
  ) into out;
  return out;
end;
$$;
revoke all on function public.analytics_student(uuid) from public, anon;
grant execute on function public.analytics_student(uuid) to authenticated;

-- The deneme list as a student sees it.
--
-- Every exam table is admin-only, and stays so: a student must never hold a
-- query against `exams` or `exam_version_items`, the second of which carries
-- every answer. What a student may know about an exam is exactly what its
-- list card shows — its name, its format, its sections, how it is scored —
-- and this function hands out that and nothing else. It is `security
-- definer` for the same reason the placement functions are: it reads tables
-- the caller cannot, and the safety is in the column list, which touches no
-- question and no answer.
--
-- Only exams that are PUBLISHED (they have a current version), VISIBLE (the
-- admin switched them on) and OPEN (no access rule — gating by plan comes
-- later and will narrow this, not widen it). What is described is the
-- current version, because that is what a student starting now would get.
--
-- The student's own standing comes back with each exam — status, how far an
-- attempt got, its score — so the list is one call. There are no attempts
-- yet (the exam runner is the next piece of work), so today every exam is
-- `not_started`, which is simply true. When attempts land, this body joins
-- them and the screen does not change.
create or replace function public.student_exams()
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
  -- [{ subject_name, question_count }] in the order a student meets them.
  sections jsonb,
  published_at timestamptz,
  status text,
  answered integer,
  correct integer
)
language sql
stable
security definer
set search_path = ''
as $$
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
    'not_started'::text,
    null::integer,
    null::integer
  from public.exams e
  join public.exam_versions v on v.id = e.current_version_id
  join public.programs p on p.id = e.program_id
  where e.is_visible
    and e.access_rule is null
    and auth.uid() is not null
  order by e.seq;
$$;

revoke all on function public.student_exams() from public, anon;
grant execute on function public.student_exams() to authenticated;

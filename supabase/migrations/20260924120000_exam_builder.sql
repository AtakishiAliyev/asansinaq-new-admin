-- The exam builder's server side: searching the bank, counting it, filling a
-- draft from a recipe, saving a draft section, and publishing a version.
--
-- Every function is `security invoker`, so each one runs under the caller's
-- RLS and a non-admin gets nothing back from any of them. None needs to be a
-- definer: everything they touch is admin-readable already, and a definer
-- granted to `authenticated` is a hole the moment a check is forgotten.
--
-- The bank is expected to reach hundreds of thousands of questions, which
-- decides two things below. Search over the wording is a trigram index, not a
-- plain ILIKE over every row; and lists page by KEYSET — "the next 50 after
-- id N" — because OFFSET re-reads everything it skips and gets slower the
-- further a builder scrolls.

create extension if not exists pg_trgm with schema extensions;

create index if not exists questions_stem_trgm_idx
  on public.questions using gin (stem extensions.gin_trgm_ops);

-- What the builder can pick from: approved, answered questions, reached by
-- topic and difficulty and walked in id order.
create index if not exists questions_pick_idx
  on public.questions (category_id, difficulty, id)
  where status = 'approved' and answer is not null;

-- ── helpers ─────────────────────────────────────────────────────────────────

create or replace function public.exam_has_figures(p_figures jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(p_figures -> 'items') = 'array'
      then jsonb_array_length(p_figures -> 'items') > 0
    else false
  end;
$$;

-- The options a published version keeps: label, the typeset text, and — for
-- a picture option — the PUBLIC url the publish step copied it to. Anything
-- else an option carries in the bank (boxes, extraction hints) stays behind.
create or replace function public.exam_snapshot_options(p_options jsonb, p_urls jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'label', o ->> 'label',
        'tex', o ->> 'tex',
        'image_url', case when o ? 'image' then p_urls ->> (o ->> 'label') end
      ))
      order by ord
    ),
    '[]'::jsonb
  )
  from jsonb_array_elements(
    case when jsonb_typeof(p_options) = 'array' then p_options else '[]'::jsonb end
  ) with ordinality as x (o, ord);
$$;

-- `%` and `_` typed into the search box are text, not wildcards.
create or replace function public.exam_like_pattern(p_search text)
returns text
language sql
immutable
set search_path = ''
as $$
  select '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
$$;

-- ── create an exam from a template ──────────────────────────────────────────
-- The number is the next free one in the program, taken under a lock so two
-- admins pressing "new" together cannot both get 07.
create or replace function public.exam_create(p_template_id bigint)
returns public.exams
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_tpl public.exam_templates;
  v_seq integer;
  v_exam public.exams;
begin
  select * into v_tpl
  from public.exam_templates
  where id = p_template_id and archived_at is null;
  if not found then
    raise exception 'Şablon tapılmadı' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('exam_seq', v_tpl.program_id));

  select coalesce(max(seq), 0) + 1 into v_seq
  from public.exams
  where program_id = v_tpl.program_id;

  insert into public.exams (program_id, template_id, seq, title, created_by)
  values (
    v_tpl.program_id,
    v_tpl.id,
    v_seq,
    replace(v_tpl.name_pattern, '{nn}', lpad(v_seq::text, 2, '0')),
    auth.uid()
  )
  returning * into v_exam;

  return v_exam;
end;
$$;

-- ── save one section of a draft ─────────────────────────────────────────────
-- The whole section at once, in order. The builder saves after every change,
-- and replacing thirty rows is simpler and safer than moving them one by one
-- through a primary key that includes the position.
create or replace function public.exam_set_items(
  p_exam_id bigint,
  p_section_position integer,
  p_question_ids bigint[]
)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_count smallint;
  v_subject bigint;
  v_wrong text;
begin
  select s.question_count, s.subject_id into v_count, v_subject
  from public.exams e
  join public.exam_template_sections s
    on s.template_id = e.template_id and s.position = p_section_position
  where e.id = p_exam_id;
  if not found then
    raise exception 'Bölmə tapılmadı' using errcode = 'P0002';
  end if;

  if coalesce(array_length(p_question_ids, 1), 0) > v_count then
    raise exception 'Bu bölməyə ən çox % sual yerləşir', v_count;
  end if;

  select string_agg('#' || u.qid::text, ', ') into v_wrong
  from unnest(p_question_ids) as u (qid)
  left join public.questions q on q.id = u.qid
  left join public.categories c on c.id = q.category_id
  where c.subject_id is distinct from v_subject;
  if v_wrong is not null then
    raise exception 'Bu suallar bu bölmənin fənninə aid deyil: %', v_wrong;
  end if;

  delete from public.exam_items
  where exam_id = p_exam_id and section_position = p_section_position;

  insert into public.exam_items (exam_id, section_position, position, question_id)
  select p_exam_id, p_section_position, u.ord, u.qid
  from unnest(p_question_ids) with ordinality as u (qid, ord);

  update public.exams set draft_updated_at = now() where id = p_exam_id;
end;
$$;

-- ── the draft, with what the builder needs to know about each slot ──────────
create or replace function public.exam_draft_items(p_exam_id bigint)
returns table (
  section_position smallint,
  item_position smallint,
  question_id bigint,
  category_id bigint,
  difficulty smallint,
  status text,
  stem text,
  options jsonb,
  answer text,
  figures jsonb,
  -- Other exams this question is also in. Warned about, never refused.
  usage_count integer,
  -- Edited in the bank after the current version copied it.
  changed_since_publish boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    i.section_position,
    i.position,
    q.id,
    q.category_id,
    q.difficulty,
    q.status,
    q.stem,
    q.options,
    q.answer::text,
    q.figures,
    (
      select count(distinct o.exam_id)::integer
      from public.exam_items o
      where o.question_id = q.id and o.exam_id <> p_exam_id
    ),
    coalesce(q.updated_at > vi.question_updated_at, false)
  from public.exam_items i
  join public.questions q on q.id = i.question_id
  join public.exams e on e.id = i.exam_id
  left join public.exam_version_items vi
    on vi.version_id = e.current_version_id and vi.question_id = q.id
  where i.exam_id = p_exam_id
  order by i.section_position, i.position;
$$;

-- ── search the bank ─────────────────────────────────────────────────────────
-- One subject at a time — a section is one subject — narrowed by topics,
-- difficulties, figures, wording, and whether the question already sits in
-- another exam. `p_exam_id` is the exam being built: its own questions come
-- back flagged `in_exam` and do not count as "used elsewhere".
create or replace function public.exam_question_search(
  p_subject_id bigint,
  p_category_ids bigint[] default null,
  p_difficulties smallint[] default null,
  p_figures text default 'any',
  p_search text default null,
  p_unused_only boolean default false,
  p_exam_id bigint default null,
  p_after_id bigint default null,
  p_limit integer default 50
)
returns table (
  id bigint,
  category_id bigint,
  difficulty smallint,
  stem text,
  options jsonb,
  answer text,
  figures jsonb,
  book_id bigint,
  page_number integer,
  q_no integer,
  usage_count integer,
  in_exam boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    q.id,
    q.category_id,
    q.difficulty,
    q.stem,
    q.options,
    q.answer::text,
    q.figures,
    q.book_id,
    q.page_number,
    q.q_no,
    (
      select count(distinct o.exam_id)::integer
      from public.exam_items o
      where o.question_id = q.id and o.exam_id is distinct from p_exam_id
    ),
    exists (
      select 1 from public.exam_items o
      where o.question_id = q.id and o.exam_id = p_exam_id
    )
  from public.questions q
  join public.categories c on c.id = q.category_id
  where q.status = 'approved'
    and q.answer is not null
    and c.subject_id = p_subject_id
    and (p_category_ids is null or q.category_id = any (p_category_ids))
    and (p_difficulties is null or q.difficulty = any (p_difficulties))
    and (
      p_figures = 'any'
      or (p_figures = 'with') = public.exam_has_figures(q.figures)
    )
    and (
      nullif(trim(p_search), '') is null
      or q.stem ilike public.exam_like_pattern(trim(p_search))
    )
    and (
      not p_unused_only
      or not exists (
        select 1 from public.exam_items o
        where o.question_id = q.id and o.exam_id is distinct from p_exam_id
      )
    )
    and (p_after_id is null or q.id > p_after_id)
  order by q.id
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

-- ── the counts beside the filters ───────────────────────────────────────────
-- One row per (topic, difficulty) under every filter EXCEPT topic and
-- difficulty. The page adds them up both ways: a topic's count under the
-- chosen difficulties, a difficulty's count under the chosen topics — so a
-- filter always says what pressing it would leave, before it is pressed.
create or replace function public.exam_question_facets(
  p_subject_id bigint,
  p_figures text default 'any',
  p_search text default null,
  p_unused_only boolean default false,
  p_exam_id bigint default null
)
returns table (category_id bigint, difficulty smallint, n bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select q.category_id, q.difficulty, count(*)::bigint
  from public.questions q
  join public.categories c on c.id = q.category_id
  where q.status = 'approved'
    and q.answer is not null
    and c.subject_id = p_subject_id
    and (
      p_figures = 'any'
      or (p_figures = 'with') = public.exam_has_figures(q.figures)
    )
    and (
      nullif(trim(p_search), '') is null
      or q.stem ilike public.exam_like_pattern(trim(p_search))
    )
    and (
      not p_unused_only
      or not exists (
        select 1 from public.exam_items o
        where o.question_id = q.id and o.exam_id is distinct from p_exam_id
      )
    )
  group by q.category_id, q.difficulty;
$$;

-- ── fill empty slots from a recipe ──────────────────────────────────────────
-- The recipe is cells of (topic, difficulty or null for any, count); the page
-- works out the cells from "spread over these topics, this share hard", and
-- this draws them at random. Never a question already in the exam, never the
-- same question twice across cells, and — unless the admin allows it — never
-- one another exam already uses. A cell the bank cannot fill comes back
-- short, and the page says by how much rather than quietly filling it from
-- somewhere else.
create or replace function public.exam_autofill_pick(
  p_exam_id bigint,
  p_cells jsonb,
  p_unused_only boolean default true
)
returns table (category_id bigint, difficulty smallint, question_id bigint)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_cell jsonb;
  v_ids bigint[];
  v_picked bigint[] := '{}';
begin
  for v_cell in select * from jsonb_array_elements(coalesce(p_cells, '[]'::jsonb)) loop
    select coalesce(array_agg(x.id), '{}') into v_ids
    from (
      select q.id
      from public.questions q
      where q.status = 'approved'
        and q.answer is not null
        and q.category_id = (v_cell ->> 'category_id')::bigint
        and (
          (v_cell ->> 'difficulty') is null
          or q.difficulty = (v_cell ->> 'difficulty')::smallint
        )
        and not (q.id = any (v_picked))
        and not exists (
          select 1 from public.exam_items o
          where o.exam_id = p_exam_id and o.question_id = q.id
        )
        and (
          not p_unused_only
          or not exists (
            select 1 from public.exam_items o
            where o.question_id = q.id and o.exam_id <> p_exam_id
          )
        )
      order by random()
      limit greatest(coalesce((v_cell ->> 'count')::integer, 0), 0)
    ) x;
    v_picked := v_picked || v_ids;
  end loop;

  return query
    select q.category_id, q.difficulty, q.id
    from public.questions q
    where q.id = any (v_picked)
    order by array_position(v_picked, q.id);
end;
$$;

-- ── publish ─────────────────────────────────────────────────────────────────
-- Checks the draft, then copies it and the template's rules into a new
-- version in one transaction.
--
-- The wording, options, answer, difficulty and topic are read HERE, from the
-- bank, not taken from the browser. What the browser supplies is only what it
-- alone can make: each figure plate rendered to SVG, and the public url of
-- each copied image — `{ "<question id>": { "figures": {…}, "options":
-- { "A": url } } }`. A figure question without its plate, or a picture
-- option without its url, stops the publish rather than going out blank.
create or replace function public.exam_publish(
  p_exam_id bigint,
  p_assets jsonb default '{}'::jsonb
)
returns public.exam_versions
language plpgsql
volatile
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_exam public.exams;
  v_tpl public.exam_templates;
  v_version public.exam_versions;
  v_problem text;
  v_rules jsonb;
  v_max numeric;
  v_total integer;
  v_no integer;
begin
  select * into v_exam from public.exams where id = p_exam_id for update;
  if not found then
    raise exception 'Deneme tapılmadı' using errcode = 'P0002';
  end if;
  select * into v_tpl from public.exam_templates where id = v_exam.template_id;

  select string_agg(
      format('%s-ci bölmə %s/%s', s.position, coalesce(n.cnt, 0), s.question_count),
      '; ' order by s.position)
    into v_problem
  from public.exam_template_sections s
  left join (
    select i.section_position, count(*) as cnt
    from public.exam_items i
    where i.exam_id = p_exam_id
    group by i.section_position
  ) n on n.section_position = s.position
  where s.template_id = v_tpl.id
    and coalesce(n.cnt, 0) <> s.question_count;
  if v_problem is not null then
    raise exception 'Bölmələr tam deyil: %', v_problem;
  end if;

  if exists (
    select 1 from public.exam_items i
    where i.exam_id = p_exam_id
      and not exists (
        select 1 from public.exam_template_sections s
        where s.template_id = v_tpl.id and s.position = i.section_position
      )
  ) then
    raise exception 'Şablonda olmayan bölmədə sual var';
  end if;

  select string_agg('#' || i.question_id::text, ', ' order by i.question_id)
    into v_problem
  from public.exam_items i
  join public.exam_template_sections s
    on s.template_id = v_tpl.id and s.position = i.section_position
  join public.questions q on q.id = i.question_id
  left join public.categories c on c.id = q.category_id
  where i.exam_id = p_exam_id
    and (
      q.status <> 'approved'
      or q.answer is null
      or c.subject_id is distinct from s.subject_id
    );
  if v_problem is not null then
    raise exception 'Bu suallar dərc oluna bilməz (təsdiqlənməyib, cavabı yoxdur və ya başqa fəndəndir): %', v_problem;
  end if;

  select string_agg('#' || i.question_id::text, ', ' order by i.question_id)
    into v_problem
  from public.exam_items i
  join public.questions q on q.id = i.question_id
  where i.exam_id = p_exam_id
    and public.exam_has_figures(q.figures)
    and (p_assets -> i.question_id::text -> 'figures') is null;
  if v_problem is not null then
    raise exception 'Bu sualların şəkli hazırlanmadı: %', v_problem;
  end if;

  select string_agg('#' || i.question_id::text || ' ' || (o ->> 'label'), ', ')
    into v_problem
  from public.exam_items i
  join public.questions q on q.id = i.question_id
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(q.options) = 'array' then q.options else '[]'::jsonb end
  ) as o
  where i.exam_id = p_exam_id
    and o ? 'image'
    and (p_assets -> i.question_id::text -> 'options' ->> (o ->> 'label')) is null;
  if v_problem is not null then
    raise exception 'Bu şəkilli variantlar hazırlanmadı: %', v_problem;
  end if;

  select
    jsonb_build_object(
      'template_id', v_tpl.id,
      'template_name', v_tpl.name,
      'duration_seconds', v_tpl.duration_seconds,
      'navigation', v_tpl.navigation,
      'pause_on_exit', v_tpl.pause_on_exit,
      'allow_retake', v_tpl.allow_retake,
      'reveal_answers', v_tpl.reveal_answers,
      'scoring_method', v_tpl.scoring_method,
      'base_score', v_tpl.base_score,
      'min_score', v_tpl.min_score,
      'sections', jsonb_agg(
        jsonb_build_object(
          'position', s.position,
          'subject_id', s.subject_id,
          'subject_name', sub.name,
          'question_count', s.question_count,
          'duration_seconds', s.duration_seconds,
          'points_correct', s.points_correct,
          'penalty_ratio', s.penalty_ratio
        )
        order by s.position
      )
    ),
    v_tpl.base_score + sum(s.question_count * s.points_correct),
    sum(s.question_count)::integer
    into v_rules, v_max, v_total
  from public.exam_template_sections s
  join public.subjects sub on sub.id = s.subject_id
  where s.template_id = v_tpl.id;

  select coalesce(max(v.version_no), 0) + 1 into v_no
  from public.exam_versions v
  where v.exam_id = p_exam_id;

  insert into public.exam_versions
    (exam_id, version_no, rules, duration_seconds, question_count, max_score, published_by)
  values
    (p_exam_id, v_no, v_rules, v_tpl.duration_seconds, v_total, v_max, auth.uid())
  returning * into v_version;

  insert into public.exam_version_items (
    version_id, seq, section_position, position, question_id, subject_id,
    category_id, difficulty, stem, options, answer, figures, question_updated_at
  )
  select
    v_version.id,
    row_number() over (order by i.section_position, i.position),
    i.section_position,
    i.position,
    q.id,
    s.subject_id,
    q.category_id,
    q.difficulty,
    coalesce(q.stem, ''),
    public.exam_snapshot_options(q.options, p_assets -> i.question_id::text -> 'options'),
    q.answer,
    p_assets -> i.question_id::text -> 'figures',
    q.updated_at
  from public.exam_items i
  join public.exam_template_sections s
    on s.template_id = v_tpl.id and s.position = i.section_position
  join public.questions q on q.id = i.question_id
  where i.exam_id = p_exam_id;

  update public.exams set current_version_id = v_version.id where id = p_exam_id;

  return v_version;
end;
$$;

-- ── grants ──────────────────────────────────────────────────────────────────
revoke all on function public.exam_has_figures(jsonb) from public, anon;
revoke all on function public.exam_snapshot_options(jsonb, jsonb) from public, anon;
revoke all on function public.exam_like_pattern(text) from public, anon;
revoke all on function public.exam_create(bigint) from public, anon;
revoke all on function public.exam_set_items(bigint, integer, bigint[]) from public, anon;
revoke all on function public.exam_draft_items(bigint) from public, anon;
revoke all on function public.exam_question_search(bigint, bigint[], smallint[], text, text, boolean, bigint, bigint, integer) from public, anon;
revoke all on function public.exam_question_facets(bigint, text, text, boolean, bigint) from public, anon;
revoke all on function public.exam_autofill_pick(bigint, jsonb, boolean) from public, anon;
revoke all on function public.exam_publish(bigint, jsonb) from public, anon;

grant execute on function public.exam_has_figures(jsonb) to authenticated;
grant execute on function public.exam_snapshot_options(jsonb, jsonb) to authenticated;
grant execute on function public.exam_like_pattern(text) to authenticated;
grant execute on function public.exam_create(bigint) to authenticated;
grant execute on function public.exam_set_items(bigint, integer, bigint[]) to authenticated;
grant execute on function public.exam_draft_items(bigint) to authenticated;
grant execute on function public.exam_question_search(bigint, bigint[], smallint[], text, text, boolean, bigint, bigint, integer) to authenticated;
grant execute on function public.exam_question_facets(bigint, text, text, boolean, bigint) to authenticated;
grant execute on function public.exam_autofill_pick(bigint, jsonb, boolean) to authenticated;
grant execute on function public.exam_publish(bigint, jsonb) to authenticated;

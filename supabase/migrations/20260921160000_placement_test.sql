-- The placement test: twelve questions, one per topic, that decide which
-- level a student starts at.
--
-- The result lives on the profile so the test is asked ONCE. A student who
-- declines is placed at `beginner` — declining is an answer, not a deferral,
-- and `placement_at` records that the question was settled either way.
--
-- Three things are deliberately server-side. The QUESTIONS are chosen here,
-- because `questions` is admin-only and a student must never hold a query
-- against it. The ANSWERS never leave the server — the rows handed out carry
-- the stem and the options and nothing else. And the LEVEL is written by
-- these functions alone: it is not in the student's column grant on
-- `profiles`, so the one thing the test decides cannot be set by the person
-- being tested.

alter table public.profiles
  add column level text,
  add column placement_score smallint,
  add column placement_at timestamptz,
  add constraint profiles_level_check
    check (level is null or level in ('beginner', 'intermediate', 'advanced')),
  add constraint profiles_placement_score_check
    check (placement_score is null or placement_score between 0 and 12);

comment on column public.profiles.level is
  'Starting level: beginner | intermediate | advanced. Written only by the placement functions.';
comment on column public.profiles.placement_at is
  'When the placement question was settled — by taking the test or by declining it. Null means it has never been asked.';

-- ── the blueprint ───────────────────────────────────────────────────────────
-- One row per question the test asks, in the order it asks them: easy first,
-- so the test opens with something answerable. A table rather than a list
-- inside the function, because which topics are worth testing is a product
-- decision that will change more often than the code around it.

create table public.placement_blueprint (
  ord smallint primary key,
  category_id bigint not null references public.categories (id) on delete restrict,
  band text not null check (band in ('asan', 'orta', 'cetin'))
);

comment on table public.placement_blueprint is
  'The twelve slots of the placement test: which topic each one draws from, and which difficulty band it stands for.';

insert into public.placement_blueprint (ord, category_id, band) values
  (1, 9, 'asan'),    -- Sayılar
  (2, 11, 'asan'),   -- Birinci dereceden denklemler
  (3, 10, 'asan'),   -- Rasyonel sayılar
  (4, 17, 'asan'),   -- Oran-orantı
  (5, 15, 'orta'),   -- Köklü sayılar
  (6, 14, 'orta'),   -- Üslü sayılar
  (7, 12, 'orta'),   -- Basit eşitsizlikler
  (8, 13, 'orta'),   -- Mutlak değer
  (9, 16, 'orta'),   -- Çarpanlara ayırma
  (10, 18, 'cetin'), -- Kümeler
  (11, 20, 'cetin'), -- Polinomlar
  (12, 19, 'cetin'); -- Fonksiyonlar

alter table public.placement_blueprint enable row level security;
-- No policy: the functions below are `security definer` and read it as the
-- owner. Nothing else needs it.

-- ── the questions ───────────────────────────────────────────────────────────

create function public.placement_start()
returns table (
  id bigint,
  category_id bigint,
  topic text,
  band text,
  stem text,
  options jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  slot record;
  picked bigint;
  chosen bigint[] := '{}';
begin
  if (select auth.uid()) is null then
    raise exception 'not signed in';
  end if;

  for slot in select * from public.placement_blueprint order by ord loop
    -- A question with a figure cannot be drawn without the figure renderer,
    -- which lives in the admin app; one with no answer cannot be scored.
    select q.id into picked
    from public.questions q
    where q.status = 'approved'
      and q.answer is not null
      and q.figures is null
      and q.stem is not null
      and q.options is not null
      and q.category_id = slot.category_id
      and not (q.id = any(chosen))
    order by random()
    limit 1;

    -- A topic the bank has nothing approved for yet must not shorten the
    -- test: the slot is filled from another topic in the same band, so the
    -- twelve stay twelve and the difficulty mix is preserved.
    if picked is null then
      select q.id into picked
      from public.questions q
      join public.placement_blueprint b on b.category_id = q.category_id
      where q.status = 'approved'
        and q.answer is not null
        and q.figures is null
        and q.stem is not null
        and q.options is not null
        and b.band = slot.band
        and not (q.id = any(chosen))
      order by random()
      limit 1;
    end if;

    if picked is not null then
      chosen := chosen || picked;
    end if;
  end loop;

  return query
  select q.id,
         q.category_id,
         c.name as topic,
         b.band,
         q.stem,
         q.options
  from unnest(chosen) with ordinality as pick(qid, n)
  join public.questions q on q.id = pick.qid
  left join public.categories c on c.id = q.category_id
  left join public.placement_blueprint b on b.category_id = q.category_id
  order by pick.n;
end;
$$;

revoke execute on function public.placement_start() from public, anon;
grant execute on function public.placement_start() to authenticated;

-- ── the verdict ─────────────────────────────────────────────────────────────

create function public.placement_submit(p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  existing record;
  correct int;
  total int;
  new_level text;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;

  -- Settled once. A second submission returns what was decided the first
  -- time rather than overwriting it, so a reload cannot re-roll a level.
  select p.level, p.placement_score into existing
  from public.profiles p where p.id = uid;
  if existing.level is not null then
    return jsonb_build_object('score', existing.placement_score, 'total', 12, 'level', existing.level, 'already', true);
  end if;

  select count(*) filter (where q.answer = a.choice), count(*)
    into correct, total
  from jsonb_to_recordset(coalesce(p_answers, '[]'::jsonb)) as a(question_id bigint, choice text)
  join public.questions q on q.id = a.question_id
  where q.status = 'approved';

  correct := least(coalesce(correct, 0), 12);

  new_level := case
    when correct >= 10 then 'advanced'
    when correct >= 7 then 'intermediate'
    else 'beginner'
  end;

  update public.profiles
  set level = new_level,
      placement_score = correct,
      placement_at = now()
  where id = uid;

  return jsonb_build_object('score', correct, 'total', 12, 'level', new_level, 'already', false);
end;
$$;

revoke execute on function public.placement_submit(jsonb) from public, anon;
grant execute on function public.placement_submit(jsonb) to authenticated;

-- ── declining ───────────────────────────────────────────────────────────────

create function public.placement_skip()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  current_level text;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;

  select level into current_level from public.profiles where id = uid;
  if current_level is not null then
    return jsonb_build_object('level', current_level, 'already', true);
  end if;

  update public.profiles
  set level = 'beginner',
      placement_score = null,
      placement_at = now()
  where id = uid;

  return jsonb_build_object('level', 'beginner', 'already', false);
end;
$$;

revoke execute on function public.placement_skip() from public, anon;
grant execute on function public.placement_skip() to authenticated;

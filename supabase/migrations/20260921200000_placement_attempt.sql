-- One attempt, and the clock belongs to the server.
--
-- Until now the fifteen minutes lived in the browser and the drawn questions
-- lived in session storage, so a student who did not like how it was going
-- could close the tab and come back to a fresh twelve and a fresh clock. The
-- attempt now lives here: which questions were dealt, when it expires, and
-- what has been answered so far. Reopening the page RESUMES it — same
-- questions, same remaining time, same answers — and there is no way to ask
-- for a different twelve.
--
-- Abandoning it is not an escape either. An attempt whose time has run out
-- is finalised from whatever was answered before the clock stopped, the
-- first time anything asks about it. There is no cron; the sweep is lazy and
-- happens on the student's own next visit, which is the only moment it
-- matters.

create table public.placement_attempts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  question_ids bigint[] not null,
  answers jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

comment on table public.placement_attempts is
  'The placement test in progress: the twelve questions dealt, the deadline, and the answers so far. One row per student, deleted when the attempt is finalised.';

alter table public.placement_attempts enable row level security;
-- No policies. Every function below is `security definer`; a student never
-- queries this table, and the answers in it are not theirs to rewrite by
-- hand.

create trigger placement_attempts_set_updated_at
  before update on public.placement_attempts
  for each row execute function public.set_updated_at();

-- ── finalising ──────────────────────────────────────────────────────────────
-- Shared by submit and by the lazy sweep, so an attempt that ran out of time
-- is scored by exactly the same rule as one that was handed in.

create function public.placement_finalize(p_user uuid, p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  correct int;
  new_level text;
begin
  select count(*) filter (where q.answer = a.value #>> '{}')
    into correct
  from jsonb_each(coalesce(p_answers, '{}'::jsonb)) as a(key, value)
  join public.questions q on q.id = a.key::bigint
  where q.status = 'approved';

  correct := least(coalesce(correct, 0), 12);

  new_level := case
    when correct >= 10 then 'advanced'
    when correct >= 7 then 'intermediate'
    else 'beginner'
  end;

  update public.profiles
  set level = new_level, placement_score = correct, placement_at = now()
  where id = p_user and level is null;

  delete from public.placement_attempts where user_id = p_user;

  return jsonb_build_object('score', correct, 'total', 12, 'level', new_level);
end;
$$;

revoke execute on function public.placement_finalize(uuid, jsonb) from public, anon, authenticated;

-- ── where the student stands ────────────────────────────────────────────────

create function public.placement_state()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  prof record;
  att record;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;

  select level, placement_score into prof from public.profiles where id = uid;
  if prof.level is not null then
    return jsonb_build_object('settled', true, 'level', prof.level, 'score', prof.placement_score, 'open', false);
  end if;

  select * into att from public.placement_attempts where user_id = uid;
  if att is null then
    return jsonb_build_object('settled', false, 'open', false);
  end if;

  -- Time ran out while nobody was looking: score what was answered.
  if att.expires_at <= now() then
    perform public.placement_finalize(uid, att.answers);
    select level, placement_score into prof from public.profiles where id = uid;
    return jsonb_build_object('settled', true, 'level', prof.level, 'score', prof.placement_score, 'open', false, 'expired', true);
  end if;

  return jsonb_build_object('settled', false, 'open', true, 'expires_at', att.expires_at);
end;
$$;

revoke execute on function public.placement_state() from public, anon;
grant execute on function public.placement_state() to authenticated;

-- ── dealing, or resuming ────────────────────────────────────────────────────

drop function if exists public.placement_start();

create function public.placement_start()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  minutes constant int := 15;
  prof record;
  att record;
  slot record;
  want smallint;
  picked bigint;
  chosen bigint[] := '{}';
  payload jsonb;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;

  select level into prof from public.profiles where id = uid;
  if prof.level is not null then
    raise exception 'placement already settled';
  end if;

  select * into att from public.placement_attempts where user_id = uid;

  if att is not null and att.expires_at <= now() then
    perform public.placement_finalize(uid, att.answers);
    raise exception 'placement already settled';
  end if;

  -- Resume: the same twelve, the same clock, the same answers. Asking again
  -- is not a way to be dealt a different hand.
  if att is null then
    for slot in select * from public.placement_blueprint order by ord loop
      want := case slot.band when 'asan' then 1 when 'orta' then 2 else 3 end;

      select q.id into picked
      from public.questions q
      join public.placement_blueprint b on b.category_id = q.category_id
      where q.status = 'approved'
        and q.answer is not null
        and q.figures is null
        and q.stem is not null
        and q.options is not null
        and not (q.id = any(chosen))
        and (q.category_id = slot.category_id or b.band = slot.band)
      order by
        case
          when q.category_id = slot.category_id and q.difficulty = want then 1
          when q.category_id = slot.category_id and q.difficulty = 2 then 2
          when b.band = slot.band and q.difficulty = want then 3
          else 4
        end,
        random()
      limit 1;

      if picked is not null then
        chosen := chosen || picked;
      end if;
    end loop;

    if array_length(chosen, 1) is null then
      raise exception 'no questions available';
    end if;

    insert into public.placement_attempts (user_id, expires_at, question_ids)
    values (uid, now() + make_interval(mins => minutes), chosen)
    returning * into att;
  end if;

  select jsonb_agg(
           jsonb_build_object(
             'id', q.id,
             'category_id', q.category_id,
             'topic', c.name,
             'band', b.band,
             'stem', q.stem,
             'options', q.options
           )
           order by pick.n
         )
    into payload
  from unnest(att.question_ids) with ordinality as pick(qid, n)
  join public.questions q on q.id = pick.qid
  left join public.categories c on c.id = q.category_id
  left join public.placement_blueprint b on b.category_id = q.category_id;

  return jsonb_build_object(
    'expires_at', att.expires_at,
    'answers', att.answers,
    'questions', coalesce(payload, '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.placement_start() from public, anon;
grant execute on function public.placement_start() to authenticated;

-- ── answering ───────────────────────────────────────────────────────────────
-- Saved as it is given, so an attempt that is abandoned or times out still
-- has something to be scored from.

create function public.placement_answer(p_question_id bigint, p_choice text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  if p_choice !~ '^[A-E]$' then
    raise exception 'bad choice';
  end if;

  update public.placement_attempts
  set answers = answers || jsonb_build_object(p_question_id::text, p_choice)
  where user_id = uid
    and expires_at > now()
    and p_question_id = any(question_ids);
end;
$$;

revoke execute on function public.placement_answer(bigint, text) from public, anon;
grant execute on function public.placement_answer(bigint, text) to authenticated;

-- ── handing in ──────────────────────────────────────────────────────────────

drop function if exists public.placement_submit(jsonb);

create function public.placement_submit(p_answers jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  prof record;
  att record;
  merged jsonb;
  result jsonb;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;

  select level, placement_score into prof from public.profiles where id = uid;
  if prof.level is not null then
    return jsonb_build_object('score', prof.placement_score, 'total', 12, 'level', prof.level, 'already', true);
  end if;

  select * into att from public.placement_attempts where user_id = uid;
  if att is null then
    raise exception 'no attempt in progress';
  end if;

  -- The client's copy is merged over the saved one rather than trusted
  -- alone: a save that failed on a flaky connection should not cost the
  -- student an answer they gave. Only answers to questions this attempt
  -- actually dealt are counted, and the scoring is the server's either way.
  merged := att.answers;
  if p_answers is not null then
    merged := merged || (
      select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
      from jsonb_each(p_answers)
      where key ~ '^\d+$'
        and key::bigint = any(att.question_ids)
        and value #>> '{}' ~ '^[A-E]$'
    );
  end if;

  result := public.placement_finalize(uid, merged);
  return result || jsonb_build_object('already', false);
end;
$$;

revoke execute on function public.placement_submit(jsonb) from public, anon;
grant execute on function public.placement_submit(jsonb) to authenticated;

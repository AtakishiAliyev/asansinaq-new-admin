-- Roadmaps: a linear learning path the admin builds from the bank — stages
-- of nodes, each node a small test of hand-picked questions — that a
-- student walks one node at a time.
--
-- A node is NOT a deneme, but it runs on the deneme's machinery. When a
-- roadmap is published every node gets a hidden exam (`exams.kind =
-- 'roadmap_node'`, never listed) and a version with its questions copied
-- in, so the runner, the server clock, the sketchpad, the result page, the
-- review, "sualda səhv var" and the analytics fact table all work as they
-- do for a deneme. What differs is written in the version's RULES:
-- `mode: 'practice'` — no time limit, linear, an answer is final the moment
-- it is given and the verdict is shown at once.
--
-- Versions, as with denemeler: the draft is edited freely; publishing takes
-- a snapshot (stages, nodes, questions). A student is bound to the version
-- they started on; a new starter gets the newest.
--
-- One open attempt per student applies to DENEMELER only. Roadmaps are
-- separate things: a student may work several roadmaps at once and a
-- roadmap beside a deneme. Inside a roadmap the order is the lock: only
-- the first incomplete node can be started, and the server is what says so.

-- ── exams learn a kind ───────────────────────────────────────────────────────
alter table public.exams
  add column if not exists kind text not null default 'deneme'
    check (kind in ('deneme', 'roadmap_node'));
-- A node's hidden exam has no template and no number in a series.
alter table public.exams alter column template_id drop not null;
alter table public.exams alter column seq drop not null;
create index if not exists exams_kind_idx on public.exams (kind, program_id);

-- Untimed practice: no duration, no clock.
alter table public.exam_versions alter column duration_seconds drop not null;

alter table public.exam_attempts
  add column if not exists kind text not null default 'deneme'
    check (kind in ('deneme', 'roadmap_node'));

drop index if exists public.exam_attempts_one_open_idx;
create unique index if not exists exam_attempts_one_open_idx
  on public.exam_attempts (user_id)
  where status = 'in_progress' and kind = 'deneme';

-- ── the draft ────────────────────────────────────────────────────────────────
create table if not exists public.roadmaps (
  id bigint generated always as identity primary key,
  program_id bigint not null references public.programs (id) on delete restrict,
  title text not null check (length(trim(title)) > 0),
  description text not null default '',
  status text not null default 'draft'
    check (status in ('draft', 'published', 'archived')),
  current_version_id bigint,
  sort_order integer not null default 0,
  draft_updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists roadmaps_program_idx on public.roadmaps (program_id, status, sort_order);
drop trigger if exists roadmaps_set_updated_at on public.roadmaps;
create trigger roadmaps_set_updated_at
  before update on public.roadmaps
  for each row execute function public.set_updated_at();

create table if not exists public.roadmap_stages (
  id bigint generated always as identity primary key,
  roadmap_id bigint not null references public.roadmaps (id) on delete cascade,
  position smallint not null check (position > 0),
  title text not null check (length(trim(title)) > 0),
  unique (roadmap_id, position) deferrable initially deferred
);

create table if not exists public.roadmap_nodes (
  id bigint generated always as identity primary key,
  stage_id bigint not null references public.roadmap_stages (id) on delete cascade,
  position smallint not null check (position > 0),
  title text not null check (length(trim(title)) > 0),
  kind text not null default 'topic_test'
    check (kind in ('topic_test', 'mixed_test', 'checkpoint')),
  -- The hidden exam that carries this node's published versions; made on
  -- the first publish and kept, so a node's attempts stay under one exam.
  exam_id bigint references public.exams (id) on delete set null,
  unique (stage_id, position) deferrable initially deferred
);
create index if not exists roadmap_nodes_exam_idx on public.roadmap_nodes (exam_id);

-- The same question may not sit twice in one node; across nodes it may.
create table if not exists public.roadmap_node_items (
  node_id bigint not null references public.roadmap_nodes (id) on delete cascade,
  position smallint not null check (position > 0),
  question_id bigint not null references public.questions (id) on delete cascade,
  primary key (node_id, position),
  unique (node_id, question_id)
);
create index if not exists roadmap_node_items_question_idx on public.roadmap_node_items (question_id);

-- ── the published snapshot ───────────────────────────────────────────────────
create table if not exists public.roadmap_versions (
  id bigint generated always as identity primary key,
  roadmap_id bigint not null references public.roadmaps (id) on delete cascade,
  version_no integer not null check (version_no > 0),
  title text not null,
  description text not null default '',
  stage_count smallint not null,
  node_count smallint not null,
  question_count integer not null,
  published_at timestamptz not null default now(),
  published_by uuid references public.profiles (id) on delete set null,
  unique (roadmap_id, version_no)
);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'roadmaps_current_version_fkey') then
    alter table public.roadmaps
      add constraint roadmaps_current_version_fkey
      foreign key (current_version_id) references public.roadmap_versions (id) on delete set null;
  end if;
end;
$$;

create table if not exists public.roadmap_version_nodes (
  id bigint generated always as identity primary key,
  version_id bigint not null references public.roadmap_versions (id) on delete cascade,
  -- The draft node this came from; gone if the draft node was deleted.
  node_id bigint references public.roadmap_nodes (id) on delete set null,
  stage_position smallint not null,
  stage_title text not null,
  position smallint not null,
  title text not null,
  kind text not null,
  question_count smallint not null,
  exam_id bigint not null references public.exams (id) on delete restrict,
  exam_version_id bigint not null references public.exam_versions (id) on delete restrict,
  unique (version_id, stage_position, position)
);
create index if not exists roadmap_version_nodes_version_idx
  on public.roadmap_version_nodes (version_id, stage_position, position);

alter table public.exam_attempts
  add column if not exists roadmap_node_id bigint references public.roadmap_version_nodes (id) on delete set null;
create index if not exists exam_attempts_roadmap_node_idx
  on public.exam_attempts (roadmap_node_id) where roadmap_node_id is not null;

-- ── the student's walk ───────────────────────────────────────────────────────
create table if not exists public.user_roadmaps (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  roadmap_id bigint not null references public.roadmaps (id) on delete cascade,
  version_id bigint not null references public.roadmap_versions (id) on delete cascade,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, roadmap_id)
);
create index if not exists user_roadmaps_user_idx on public.user_roadmaps (user_id, started_at desc);

create table if not exists public.user_roadmap_nodes (
  user_roadmap_id bigint not null references public.user_roadmaps (id) on delete cascade,
  version_node_id bigint not null references public.roadmap_version_nodes (id) on delete cascade,
  attempt_id bigint references public.exam_attempts (id) on delete set null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (user_roadmap_id, version_node_id)
);

-- ── access ───────────────────────────────────────────────────────────────────
-- The draft and the snapshot are the admin's; the student's tables are
-- reached only through the functions below, and admins read them.
alter table public.roadmaps enable row level security;
alter table public.roadmap_stages enable row level security;
alter table public.roadmap_nodes enable row level security;
alter table public.roadmap_node_items enable row level security;
alter table public.roadmap_versions enable row level security;
alter table public.roadmap_version_nodes enable row level security;
alter table public.user_roadmaps enable row level security;
alter table public.user_roadmap_nodes enable row level security;

drop policy if exists roadmaps_admin on public.roadmaps;
create policy roadmaps_admin on public.roadmaps for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists roadmap_stages_admin on public.roadmap_stages;
create policy roadmap_stages_admin on public.roadmap_stages for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists roadmap_nodes_admin on public.roadmap_nodes;
create policy roadmap_nodes_admin on public.roadmap_nodes for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists roadmap_node_items_admin on public.roadmap_node_items;
create policy roadmap_node_items_admin on public.roadmap_node_items for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists roadmap_versions_admin_select on public.roadmap_versions;
create policy roadmap_versions_admin_select on public.roadmap_versions for select to authenticated
  using ((select public.is_admin()));
drop policy if exists roadmap_version_nodes_admin_select on public.roadmap_version_nodes;
create policy roadmap_version_nodes_admin_select on public.roadmap_version_nodes for select to authenticated
  using ((select public.is_admin()));
drop policy if exists user_roadmaps_admin_select on public.user_roadmaps;
create policy user_roadmaps_admin_select on public.user_roadmaps for select to authenticated
  using ((select public.is_admin()));
drop policy if exists user_roadmap_nodes_admin_select on public.user_roadmap_nodes;
create policy user_roadmap_nodes_admin_select on public.user_roadmap_nodes for select to authenticated
  using ((select public.is_admin()));

grant select, insert, update, delete on public.roadmaps, public.roadmap_stages,
  public.roadmap_nodes, public.roadmap_node_items to authenticated;
grant select on public.roadmap_versions, public.roadmap_version_nodes,
  public.user_roadmaps, public.user_roadmap_nodes to authenticated;

-- ── admin: structure ─────────────────────────────────────────────────────────
create or replace function public.roadmap_touch(p_roadmap_id bigint)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.roadmaps set draft_updated_at = now() where id = p_roadmap_id;
$$;
revoke all on function public.roadmap_touch(bigint) from public, anon, authenticated;

create or replace function public.roadmap_create(p_program_id bigint, p_title text)
returns public.roadmaps
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r public.roadmaps;
begin
  if not (select public.is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.roadmaps (program_id, title, created_by, sort_order)
  values (
    p_program_id, btrim(p_title), auth.uid(),
    coalesce((select max(sort_order) + 1 from public.roadmaps where program_id = p_program_id), 0)
  )
  returning * into r;
  insert into public.roadmap_stages (roadmap_id, position, title)
  values (r.id, 1, '1-ci mərhələ');
  return r;
end;
$$;

-- Stages and nodes are reordered by the FULL list of ids in their new order,
-- so two quick drags cannot leave a gap or a duplicate; the deferred unique
-- constraints let the positions swap inside one statement.
create or replace function public.roadmap_stage_add(p_roadmap_id bigint, p_title text)
returns public.roadmap_stages
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  s public.roadmap_stages;
begin
  if not (select public.is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.roadmap_stages (roadmap_id, position, title)
  values (
    p_roadmap_id,
    coalesce((select max(position) + 1 from public.roadmap_stages where roadmap_id = p_roadmap_id), 1),
    btrim(p_title)
  )
  returning * into s;
  perform public.roadmap_touch(p_roadmap_id);
  return s;
end;
$$;

create or replace function public.roadmap_stage_reorder(p_roadmap_id bigint, p_stage_ids bigint[])
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not (select public.is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if (select count(*) from public.roadmap_stages where roadmap_id = p_roadmap_id)
     <> coalesce(array_length(p_stage_ids, 1), 0)
     or exists (
       select 1 from public.roadmap_stages
       where roadmap_id = p_roadmap_id and not (id = any (p_stage_ids))
     ) then
    raise exception 'Mərhələlərin siyahısı tam deyil';
  end if;
  update public.roadmap_stages s
  set position = o.ord
  from unnest(p_stage_ids) with ordinality as o(id, ord)
  where s.id = o.id and s.roadmap_id = p_roadmap_id;
  perform public.roadmap_touch(p_roadmap_id);
end;
$$;

create or replace function public.roadmap_stage_delete(p_stage_id bigint)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_roadmap bigint;
begin
  if not (select public.is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select roadmap_id into v_roadmap from public.roadmap_stages where id = p_stage_id;
  if not found then return; end if;
  delete from public.roadmap_stages where id = p_stage_id;
  -- Close the gap.
  update public.roadmap_stages s
  set position = o.ord
  from (
    select id, row_number() over (order by position) as ord
    from public.roadmap_stages where roadmap_id = v_roadmap
  ) o
  where s.id = o.id;
  perform public.roadmap_touch(v_roadmap);
end;
$$;

create or replace function public.roadmap_node_add(p_stage_id bigint, p_title text, p_kind text default 'topic_test')
returns public.roadmap_nodes
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  n public.roadmap_nodes;
  v_roadmap bigint;
begin
  if not (select public.is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select roadmap_id into v_roadmap from public.roadmap_stages where id = p_stage_id;
  if not found then
    raise exception 'Mərhələ tapılmadı' using errcode = 'P0002';
  end if;
  insert into public.roadmap_nodes (stage_id, position, title, kind)
  values (
    p_stage_id,
    coalesce((select max(position) + 1 from public.roadmap_nodes where stage_id = p_stage_id), 1),
    btrim(p_title), p_kind
  )
  returning * into n;
  perform public.roadmap_touch(v_roadmap);
  return n;
end;
$$;

-- Moves a node to a stage (the same or another) at a position, and renumbers
-- both stages. One function for "reorder" and "move between stages".
create or replace function public.roadmap_node_move(p_node_id bigint, p_stage_id bigint, p_position integer)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  n public.roadmap_nodes;
  v_roadmap bigint;
  v_target_roadmap bigint;
begin
  if not (select public.is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into n from public.roadmap_nodes where id = p_node_id;
  if not found then
    raise exception 'Node tapılmadı' using errcode = 'P0002';
  end if;
  select roadmap_id into v_roadmap from public.roadmap_stages where id = n.stage_id;
  select roadmap_id into v_target_roadmap from public.roadmap_stages where id = p_stage_id;
  if v_target_roadmap is distinct from v_roadmap then
    raise exception 'Node başqa yol xəritəsinə köçürülə bilməz';
  end if;

  -- Park it, renumber the old stage, then slot it into the new one.
  update public.roadmap_nodes set position = 32000 where id = p_node_id;
  update public.roadmap_nodes x
  set position = o.ord
  from (
    select id, row_number() over (order by position) as ord
    from public.roadmap_nodes where stage_id = n.stage_id and id <> p_node_id
  ) o
  where x.id = o.id;
  update public.roadmap_nodes x
  set position = o.ord + (case when o.ord >= greatest(1, p_position) then 1 else 0 end)
  from (
    select id, row_number() over (order by position) as ord
    from public.roadmap_nodes where stage_id = p_stage_id and id <> p_node_id
  ) o
  where x.id = o.id;
  update public.roadmap_nodes
  set stage_id = p_stage_id,
      position = least(
        greatest(1, p_position),
        (select count(*) + 1 from public.roadmap_nodes where stage_id = p_stage_id and id <> p_node_id)
      )
  where id = p_node_id;
  perform public.roadmap_touch(v_roadmap);
end;
$$;

create or replace function public.roadmap_node_delete(p_node_id bigint)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  n public.roadmap_nodes;
  v_roadmap bigint;
begin
  if not (select public.is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into n from public.roadmap_nodes where id = p_node_id;
  if not found then return; end if;
  select roadmap_id into v_roadmap from public.roadmap_stages where id = n.stage_id;
  delete from public.roadmap_nodes where id = p_node_id;
  update public.roadmap_nodes x
  set position = o.ord
  from (
    select id, row_number() over (order by position) as ord
    from public.roadmap_nodes where stage_id = n.stage_id
  ) o
  where x.id = o.id;
  perform public.roadmap_touch(v_roadmap);
end;
$$;

-- The node's questions, in the admin's order, replaced as a whole.
create or replace function public.roadmap_node_set_items(p_node_id bigint, p_question_ids bigint[])
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_roadmap bigint;
begin
  if not (select public.is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select s.roadmap_id into v_roadmap
  from public.roadmap_nodes n join public.roadmap_stages s on s.id = n.stage_id
  where n.id = p_node_id;
  if not found then
    raise exception 'Node tapılmadı' using errcode = 'P0002';
  end if;
  delete from public.roadmap_node_items where node_id = p_node_id;
  insert into public.roadmap_node_items (node_id, position, question_id)
  select p_node_id, o.ord, o.qid
  from unnest(p_question_ids) with ordinality as o(qid, ord);
  perform public.roadmap_touch(v_roadmap);
end;
$$;

-- ── admin: publishing ────────────────────────────────────────────────────────
-- What can stop a publish, as a list the screen shows; empty means go.
create or replace function public.roadmap_publish_problems(p_roadmap_id bigint)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_problems text[] := '{}';
  v_text text;
begin
  if not (select public.is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.roadmap_stages where roadmap_id = p_roadmap_id) then
    v_problems := v_problems || 'Ən azı bir mərhələ lazımdır';
  end if;
  if not exists (
    select 1 from public.roadmap_nodes n
    join public.roadmap_stages s on s.id = n.stage_id
    where s.roadmap_id = p_roadmap_id
  ) then
    v_problems := v_problems || 'Ən azı bir node lazımdır';
  end if;
  select string_agg(s.title || ' → ' || n.title, ', ' order by s.position, n.position) into v_text
  from public.roadmap_nodes n
  join public.roadmap_stages s on s.id = n.stage_id
  where s.roadmap_id = p_roadmap_id
    and not exists (select 1 from public.roadmap_node_items i where i.node_id = n.id);
  if v_text is not null then
    v_problems := v_problems || ('Sualsız node: ' || v_text);
  end if;
  select string_agg(s.title, ', ' order by s.position) into v_text
  from public.roadmap_stages s
  where s.roadmap_id = p_roadmap_id
    and not exists (select 1 from public.roadmap_nodes n where n.stage_id = s.id);
  if v_text is not null then
    v_problems := v_problems || ('Boş mərhələ: ' || v_text);
  end if;
  select string_agg('#' || q.id::text, ', ' order by q.id) into v_text
  from public.roadmap_node_items i
  join public.roadmap_nodes n on n.id = i.node_id
  join public.roadmap_stages s on s.id = n.stage_id
  join public.questions q on q.id = i.question_id
  where s.roadmap_id = p_roadmap_id
    and (q.status <> 'approved' or q.answer is null);
  if v_text is not null then
    v_problems := v_problems || ('Təsdiqlənməmiş və ya cavabsız sual: ' || v_text);
  end if;
  return v_problems;
end;
$$;

-- Every question of the roadmap, for the browser to render figure plates
-- for (the same shape the exam publish asks for).
create or replace function public.roadmap_draft_questions(p_roadmap_id bigint)
returns table (node_id bigint, item_position smallint, question_id bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select i.node_id, i.position as item_position, i.question_id
  from public.roadmap_node_items i
  join public.roadmap_nodes n on n.id = i.node_id
  join public.roadmap_stages s on s.id = n.stage_id
  where s.roadmap_id = p_roadmap_id and (select public.is_admin())
  order by s.position, n.position, i.position;
$$;

create or replace function public.roadmap_publish(p_roadmap_id bigint, p_assets jsonb)
returns public.roadmap_versions
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r public.roadmaps;
  v_problems text[];
  v_no integer;
  ver public.roadmap_versions;
  st record;
  nd record;
  v_exam_id bigint;
  v_exam_version public.exam_versions;
  v_rules jsonb;
  v_sections jsonb;
  v_count integer;
  v_problem text;
begin
  if not (select public.is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into r from public.roadmaps where id = p_roadmap_id for update;
  if not found then
    raise exception 'Yol xəritəsi tapılmadı' using errcode = 'P0002';
  end if;
  v_problems := public.roadmap_publish_problems(p_roadmap_id);
  if coalesce(array_length(v_problems, 1), 0) > 0 then
    raise exception 'Dərc oluna bilməz: %', array_to_string(v_problems, '; ');
  end if;

  -- Figures and option images must have been rendered, as for a deneme.
  select string_agg('#' || q.id::text, ', ' order by q.id) into v_problem
  from public.roadmap_node_items i
  join public.roadmap_nodes n on n.id = i.node_id
  join public.roadmap_stages s on s.id = n.stage_id
  join public.questions q on q.id = i.question_id
  where s.roadmap_id = p_roadmap_id
    and public.exam_has_figures(q.figures)
    and (p_assets -> q.id::text -> 'figures') is null;
  if v_problem is not null then
    raise exception 'Bu sualların şəkli hazırlanmadı: %', v_problem;
  end if;

  select coalesce(max(version_no), 0) + 1 into v_no
  from public.roadmap_versions where roadmap_id = p_roadmap_id;

  insert into public.roadmap_versions
    (roadmap_id, version_no, title, description, stage_count, node_count, question_count, published_by)
  select
    p_roadmap_id, v_no, r.title, r.description,
    (select count(*) from public.roadmap_stages where roadmap_id = p_roadmap_id),
    (select count(*) from public.roadmap_nodes n join public.roadmap_stages s on s.id = n.stage_id where s.roadmap_id = p_roadmap_id),
    (select count(*) from public.roadmap_node_items i join public.roadmap_nodes n on n.id = i.node_id join public.roadmap_stages s on s.id = n.stage_id where s.roadmap_id = p_roadmap_id),
    auth.uid()
  returning * into ver;

  for st in
    select * from public.roadmap_stages where roadmap_id = p_roadmap_id order by position
  loop
    for nd in
      select * from public.roadmap_nodes where stage_id = st.id order by position
    loop
      -- The node's hidden exam: made once, versioned on every publish.
      v_exam_id := nd.exam_id;
      if v_exam_id is null then
        insert into public.exams (program_id, kind, title, is_visible, created_by)
        values (r.program_id, 'roadmap_node', nd.title, false, auth.uid())
        returning id into v_exam_id;
        update public.roadmap_nodes set exam_id = v_exam_id where id = nd.id;
      else
        update public.exams set title = nd.title where id = v_exam_id;
      end if;

      -- Sections: one per subject present, in order of first appearance,
      -- one point per correct answer and no penalty. Scoring stays the
      -- deneme's own function; the rules make it "count the right ones".
      select count(*) into v_count from public.roadmap_node_items where node_id = nd.id;
      select jsonb_agg(
        jsonb_build_object(
          'position', x.pos,
          'subject_id', x.subject_id,
          'subject_name', x.subject_name,
          'question_count', x.n,
          'points_correct', 1,
          'penalty_ratio', 0
        ) order by x.pos
      ) into v_sections
      from (
        select c.subject_id, sub.name as subject_name, count(*) as n,
          row_number() over (order by min(i.position)) as pos
        from public.roadmap_node_items i
        join public.questions q on q.id = i.question_id
        join public.categories c on c.id = q.category_id
        join public.subjects sub on sub.id = c.subject_id
        where i.node_id = nd.id
        group by c.subject_id, sub.name
      ) x;

      v_rules := jsonb_build_object(
        'mode', 'practice',
        'timed', false,
        'feedback', 'immediate',
        'navigation', 'linear',
        'pause_on_exit', true,
        'allow_retake', false,
        'reveal_answers', 'after_submit',
        'scoring_method', 'count',
        'base_score', 0,
        'min_score', 0,
        'template_name', 'Yol xəritəsi',
        'sections', v_sections
      );

      insert into public.exam_versions
        (exam_id, version_no, rules, duration_seconds, question_count, max_score, published_by)
      values (
        v_exam_id,
        coalesce((select max(version_no) from public.exam_versions where exam_id = v_exam_id), 0) + 1,
        v_rules, null, v_count, v_count, auth.uid()
      )
      returning * into v_exam_version;

      insert into public.exam_version_items (
        version_id, seq, section_position, position, question_id, subject_id,
        category_id, difficulty, stem, options, answer, figures, question_updated_at
      )
      select
        v_exam_version.id,
        i.position,
        sec.pos,
        row_number() over (partition by sec.pos order by i.position),
        q.id,
        c.subject_id,
        q.category_id,
        q.difficulty,
        coalesce(q.stem, ''),
        public.exam_snapshot_options(q.options, p_assets -> q.id::text -> 'options'),
        q.answer,
        p_assets -> q.id::text -> 'figures',
        q.updated_at
      from public.roadmap_node_items i
      join public.questions q on q.id = i.question_id
      join public.categories c on c.id = q.category_id
      join (
        select (x ->> 'subject_id')::bigint as subject_id, (x ->> 'position')::integer as pos
        from jsonb_array_elements(v_sections) x
      ) sec on sec.subject_id = c.subject_id
      where i.node_id = nd.id;

      update public.exams set current_version_id = v_exam_version.id where id = v_exam_id;

      insert into public.roadmap_version_nodes
        (version_id, node_id, stage_position, stage_title, position, title, kind, question_count, exam_id, exam_version_id)
      values
        (ver.id, nd.id, st.position, st.title, nd.position, nd.title, nd.kind, v_count, v_exam_id, v_exam_version.id);
    end loop;
  end loop;

  update public.roadmaps
  set status = 'published', current_version_id = ver.id
  where id = p_roadmap_id;
  return ver;
end;
$$;

create or replace function public.roadmap_archive(p_roadmap_id bigint, p_archived boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not (select public.is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.roadmaps
  set status = case
    when p_archived then 'archived'
    when current_version_id is not null then 'published'
    else 'draft' end
  where id = p_roadmap_id;
end;
$$;

revoke all on function public.roadmap_create(bigint, text) from public, anon;
revoke all on function public.roadmap_stage_add(bigint, text) from public, anon;
revoke all on function public.roadmap_stage_reorder(bigint, bigint[]) from public, anon;
revoke all on function public.roadmap_stage_delete(bigint) from public, anon;
revoke all on function public.roadmap_node_add(bigint, text, text) from public, anon;
revoke all on function public.roadmap_node_move(bigint, bigint, integer) from public, anon;
revoke all on function public.roadmap_node_delete(bigint) from public, anon;
revoke all on function public.roadmap_node_set_items(bigint, bigint[]) from public, anon;
revoke all on function public.roadmap_publish_problems(bigint) from public, anon;
revoke all on function public.roadmap_draft_questions(bigint) from public, anon;
revoke all on function public.roadmap_publish(bigint, jsonb) from public, anon;
revoke all on function public.roadmap_archive(bigint, boolean) from public, anon;
grant execute on function public.roadmap_create(bigint, text) to authenticated;
grant execute on function public.roadmap_stage_add(bigint, text) to authenticated;
grant execute on function public.roadmap_stage_reorder(bigint, bigint[]) to authenticated;
grant execute on function public.roadmap_stage_delete(bigint) to authenticated;
grant execute on function public.roadmap_node_add(bigint, text, text) to authenticated;
grant execute on function public.roadmap_node_move(bigint, bigint, integer) to authenticated;
grant execute on function public.roadmap_node_delete(bigint) to authenticated;
grant execute on function public.roadmap_node_set_items(bigint, bigint[]) to authenticated;
grant execute on function public.roadmap_publish_problems(bigint) to authenticated;
grant execute on function public.roadmap_draft_questions(bigint) to authenticated;
grant execute on function public.roadmap_publish(bigint, jsonb) to authenticated;
grant execute on function public.roadmap_archive(bigint, boolean) to authenticated;

-- ── the deneme machinery learns about kinds and practice ─────────────────────

-- The clock: an untimed version charges time for the record but never runs out.
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

  if v_limit is null then
    update public.exam_attempts
    set time_used_seconds = time_used_seconds + v_gap,
        last_seen_at = now()
    where id = a.id;
    return 2147483647;
  end if;

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

-- The payload carries the mode, so one runner can be an exam or a practice.
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
  rn public.roadmap_version_nodes;
begin
  select * into a from public.exam_attempts where id = p_attempt_id and user_id = auth.uid();
  if not found then
    raise exception 'Cəhd tapılmadı' using errcode = 'P0002';
  end if;
  select * into v from public.exam_versions where id = a.version_id;
  select * into e from public.exams where id = a.exam_id;
  v_left := case when v.duration_seconds is null then null
                 else greatest(0, v.duration_seconds - a.time_used_seconds) end;
  if a.roadmap_node_id is not null then
    select * into rn from public.roadmap_version_nodes where id = a.roadmap_node_id;
  end if;

  return jsonb_build_object(
    'attempt', jsonb_build_object(
      'id', a.id,
      'exam_id', a.exam_id,
      'kind', a.kind,
      'title', e.title,
      'attempt_no', a.attempt_no,
      'status', a.status,
      'current_seq', a.current_seq,
      'remaining_seconds', v_left,
      'duration_seconds', v.duration_seconds,
      'question_count', v.question_count,
      'max_score', v.max_score,
      'navigation', v.rules ->> 'navigation',
      'feedback', coalesce(v.rules ->> 'feedback', 'none'),
      'roadmap', case when rn.id is null then null else jsonb_build_object(
        'roadmap_id', (select roadmap_id from public.roadmap_versions where id = rn.version_id),
        'version_node_id', rn.id,
        'stage_title', rn.stage_title,
        'node_title', rn.title
      ) end,
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
    ),
    -- In practice mode the verdicts already given travel with the payload,
    -- so a resumed sitting shows them again.
    'verdicts', case when coalesce(v.rules ->> 'feedback', 'none') = 'immediate' then (
      select coalesce(jsonb_object_agg(r.seq::text, i.answer), '{}'::jsonb)
      from public.attempt_responses r
      join public.exam_version_items i on i.version_id = a.version_id and i.seq = r.seq
      where r.attempt_id = a.id and r.choice is not null
    ) else '{}'::jsonb end
  );
end;
$$;

-- Denemeler only: the open-attempt rule and the list are theirs.
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
  where user_id = v_user and status = 'in_progress' and kind = 'deneme';
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
  where id = p_exam_id and kind = 'deneme' and is_visible and access_rule is null and current_version_id is not null;
  if not found then
    raise exception 'Deneme tapılmadı' using errcode = 'P0002';
  end if;
  select * into v from public.exam_versions where id = e.current_version_id;

  select coalesce(max(attempt_no), 0) + 1 into v_no
  from public.exam_attempts where user_id = v_user and exam_id = p_exam_id;
  if v_no > 1 and not coalesce((v.rules ->> 'allow_retake')::boolean, true) then
    raise exception 'Bu deneme bir dəfə işlənə bilər';
  end if;

  insert into public.exam_attempts (user_id, exam_id, version_id, attempt_no, kind)
  values (v_user, p_exam_id, v.id, v_no, 'deneme')
  returning id into v_id;

  insert into public.attempt_events (attempt_id, seq, kind, at)
  values (v_id, 1, 'start', now());

  return public.attempt_payload(v_id);
end;
$$;

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
  where user_id = auth.uid() and status = 'in_progress' and kind = 'deneme';
  if not found then
    return null;
  end if;
  perform public.attempt_touch(v_open.id);
  select * into v_open from public.exam_attempts where id = v_open.id;
  if v_open.status <> 'in_progress' then
    return null;
  end if;
  return public.attempt_payload(v_open.id);
end;
$$;

-- In practice an answer is final: the verdict was shown the moment it was
-- given, so changing it afterwards would be a second look at the key.
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
  v_feedback text;
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

  select coalesce(v.rules ->> 'feedback', 'none') into v_feedback
  from public.exam_attempts a join public.exam_versions v on v.id = a.version_id
  where a.id = p_attempt_id;
  if v_feedback = 'immediate' and (v_prev is not null or p_choice is null) then
    raise exception 'locked' using errcode = 'P0001';
  end if;

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

-- Practice: answer and hear the verdict in one call.
create or replace function public.attempt_answer_check(p_attempt_id bigint, p_seq integer, p_choice text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  a public.exam_attempts;
  v_feedback text;
  v_answer char(1);
  v_left integer;
begin
  select * into a from public.exam_attempts where id = p_attempt_id and user_id = auth.uid();
  if not found then
    raise exception 'Cəhd tapılmadı' using errcode = 'P0002';
  end if;
  select coalesce(v.rules ->> 'feedback', 'none') into v_feedback
  from public.exam_versions v where v.id = a.version_id;
  if v_feedback <> 'immediate' then
    raise exception 'not practice' using errcode = 'P0001';
  end if;
  v_left := public.attempt_answer(p_attempt_id, p_seq, p_choice, null);
  select answer into v_answer from public.exam_version_items
  where version_id = a.version_id and seq = p_seq;
  return jsonb_build_object('left', v_left, 'answer', v_answer, 'is_correct', v_answer = p_choice);
end;
$$;
revoke all on function public.attempt_answer_check(bigint, integer, text) from public, anon;
grant execute on function public.attempt_answer_check(bigint, integer, text) to authenticated;

-- The result names the roadmap it belongs to, so the screen can offer the
-- way back to the path.
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
    'kind', a.kind,
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
    'reveal_answers', v.rules ->> 'reveal_answers',
    'roadmap', case when rn.id is null then null else jsonb_build_object(
      'roadmap_id', rv.roadmap_id,
      'version_node_id', rn.id,
      'stage_title', rn.stage_title,
      'node_title', rn.title,
      'roadmap_title', rv.title
    ) end
  )
  from public.exam_attempts a
  join public.exam_versions v on v.id = a.version_id
  join public.exams e on e.id = a.exam_id
  left join public.roadmap_version_nodes rn on rn.id = a.roadmap_node_id
  left join public.roadmap_versions rv on rv.id = rn.version_id
  where a.id = p_attempt_id and a.user_id = auth.uid() and a.status = 'submitted';
$$;

-- The list stays the denemeler's.
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
  where e.kind = 'deneme'
    and e.is_visible
    and e.access_rule is null
    and auth.uid() is not null
  order by e.seq;
end;
$$;

-- Facts from a roadmap sitting are the roadmap's, not a deneme's.
alter table public.question_responses add column if not exists context_node_id bigint;

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
  v_kind text;
  v_context bigint;
  v_node bigint;
begin
  select * into a from public.exam_attempts where id = p_attempt_id;
  if not found or a.status <> 'submitted' then
    return 0;
  end if;

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

  if a.roadmap_node_id is not null then
    v_kind := 'roadmap';
    v_node := a.roadmap_node_id;
    select rv.roadmap_id into v_context
    from public.roadmap_version_nodes rn join public.roadmap_versions rv on rv.id = rn.version_id
    where rn.id = a.roadmap_node_id;
  else
    v_kind := 'deneme';
    v_context := a.exam_id;
    v_node := null;
  end if;

  insert into public.question_responses (
    question_id, user_id, context_kind, context_id, context_version_id,
    context_attempt_id, context_seq, attempt_no, subject_id, category_id,
    difficulty, answer, choice, is_correct, is_blank, time_seconds,
    change_count, board_used, answers_seen_before, answered_at, context_node_id
  )
  select
    i.question_id, a.user_id, v_kind, v_context, a.version_id,
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
    r.updated_at,
    v_node
  from public.exam_version_items i
  left join public.attempt_responses r on r.attempt_id = a.id and r.seq = i.seq
  where i.version_id = a.version_id
  on conflict (context_kind, context_attempt_id, context_seq) do nothing;

  get diagnostics v_written = row_count;
  return v_written;
end;
$$;

-- Hand-in completes the node; the next one is simply the first incomplete.
create or replace function public.roadmap_node_complete(p_attempt_id bigint)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  a public.exam_attempts;
  ur public.user_roadmaps;
begin
  select * into a from public.exam_attempts where id = p_attempt_id;
  if not found or a.roadmap_node_id is null or a.status <> 'submitted' then
    return;
  end if;
  update public.user_roadmap_nodes n
  set completed_at = coalesce(n.completed_at, now())
  from public.user_roadmaps u
  where n.user_roadmap_id = u.id and u.user_id = a.user_id
    and n.version_node_id = a.roadmap_node_id
  returning u.* into ur;
  if ur.id is null then
    return;
  end if;
  if not exists (
    select 1 from public.roadmap_version_nodes rn
    left join public.user_roadmap_nodes n on n.user_roadmap_id = ur.id and n.version_node_id = rn.id
    where rn.version_id = ur.version_id and n.completed_at is null
  ) then
    update public.user_roadmaps set completed_at = coalesce(completed_at, now()) where id = ur.id;
  end if;
end;
$$;
revoke all on function public.roadmap_node_complete(bigint) from public, anon, authenticated;

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
  perform public.roadmap_node_complete(a.id);
end;
$$;

-- ── the student's side ───────────────────────────────────────────────────────
-- Every published roadmap, with where this student stands on it.
create or replace function public.roadmaps_list()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', r.id,
      'title', coalesce(uv.title, cv.title),
      'description', coalesce(uv.description, cv.description),
      'stage_count', coalesce(uv.stage_count, cv.stage_count),
      'node_count', coalesce(uv.node_count, cv.node_count),
      'question_count', coalesce(uv.question_count, cv.question_count),
      'program_name', p.name,
      'status', case
        when ur.completed_at is not null then 'completed'
        when ur.id is not null then 'in_progress'
        else 'not_started' end,
      'completed_nodes', coalesce((
        select count(*) from public.user_roadmap_nodes n
        where n.user_roadmap_id = ur.id and n.completed_at is not null
      ), 0),
      'started_at', ur.started_at,
      'completed_at', ur.completed_at
    )
    order by r.sort_order, r.id
  ), '[]'::jsonb)
  from public.roadmaps r
  join public.programs p on p.id = r.program_id
  join public.roadmap_versions cv on cv.id = r.current_version_id
  left join public.user_roadmaps ur on ur.roadmap_id = r.id and ur.user_id = auth.uid()
  left join public.roadmap_versions uv on uv.id = ur.version_id
  where r.status = 'published' and auth.uid() is not null;
$$;

-- The path: stages and nodes of the version this student is on (or the
-- current one, before they start), each node with its state.
create or replace function public.roadmap_detail(p_roadmap_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.roadmaps;
  ur public.user_roadmaps;
  ver public.roadmap_versions;
  v_current bigint;
begin
  select * into r from public.roadmaps where id = p_roadmap_id and status = 'published';
  if not found or auth.uid() is null then
    raise exception 'Yol xəritəsi tapılmadı' using errcode = 'P0002';
  end if;
  select * into ur from public.user_roadmaps where roadmap_id = r.id and user_id = auth.uid();
  select * into ver from public.roadmap_versions
  where id = coalesce(ur.version_id, r.current_version_id);

  -- The first node without a completion is the current one.
  select rn.id into v_current
  from public.roadmap_version_nodes rn
  left join public.user_roadmap_nodes n on n.user_roadmap_id = ur.id and n.version_node_id = rn.id
  where rn.version_id = ver.id and (n.completed_at is null)
  order by rn.stage_position, rn.position
  limit 1;

  return jsonb_build_object(
    'id', r.id,
    'title', ver.title,
    'description', ver.description,
    'version_no', ver.version_no,
    'status', case
      when ur.completed_at is not null then 'completed'
      when ur.id is not null then 'in_progress'
      else 'not_started' end,
    'started_at', ur.started_at,
    'completed_at', ur.completed_at,
    'node_count', ver.node_count,
    'completed_nodes', coalesce((
      select count(*) from public.user_roadmap_nodes n
      where n.user_roadmap_id = ur.id and n.completed_at is not null
    ), 0),
    'stages', (
      select coalesce(jsonb_agg(jsonb_build_object('position', st.pos, 'title', st.title, 'nodes', st.nodes) order by st.pos), '[]'::jsonb) from (
        select rn.stage_position as pos, rn.stage_title as title,
          jsonb_agg(
            jsonb_build_object(
              'id', rn.id,
              'position', rn.position,
              'title', rn.title,
              'kind', rn.kind,
              'question_count', rn.question_count,
              'state', case
                when n.completed_at is not null then 'completed'
                when ur.id is not null and rn.id = v_current then 'current'
                when ur.id is null and rn.id = v_current then 'current'
                else 'locked' end,
              'attempt_id', n.attempt_id,
              'in_progress', (n.attempt_id is not null and n.completed_at is null),
              'correct', a.correct_count,
              'completed_at', n.completed_at
            ) order by rn.position
          ) as nodes
        from public.roadmap_version_nodes rn
        left join public.user_roadmap_nodes n on n.user_roadmap_id = ur.id and n.version_node_id = rn.id
        left join public.exam_attempts a on a.id = n.attempt_id and a.status = 'submitted'
        where rn.version_id = ver.id
        group by rn.stage_position, rn.stage_title
      ) st
    )
  );
end;
$$;

create or replace function public.roadmap_start(p_roadmap_id bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r public.roadmaps;
begin
  select * into r from public.roadmaps where id = p_roadmap_id and status = 'published';
  if not found or auth.uid() is null then
    raise exception 'Yol xəritəsi tapılmadı' using errcode = 'P0002';
  end if;
  insert into public.user_roadmaps (user_id, roadmap_id, version_id)
  values (auth.uid(), r.id, r.current_version_id)
  on conflict (user_id, roadmap_id) do nothing;
  return public.roadmap_detail(p_roadmap_id);
end;
$$;

-- Opens the node's test — only the current node; a completed node hands
-- back its result instead; anything else is locked, whatever URL asked.
create or replace function public.roadmap_node_start(p_version_node_id bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  rn public.roadmap_version_nodes;
  ver public.roadmap_versions;
  ur public.user_roadmaps;
  n public.user_roadmap_nodes;
  v_current bigint;
  v_open public.exam_attempts;
  v_no integer;
  v_id bigint;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  select * into rn from public.roadmap_version_nodes where id = p_version_node_id;
  if not found then
    raise exception 'Node tapılmadı' using errcode = 'P0002';
  end if;
  select * into ver from public.roadmap_versions where id = rn.version_id;
  select * into ur from public.user_roadmaps
  where user_id = auth.uid() and roadmap_id = ver.roadmap_id;
  if not found or ur.version_id <> rn.version_id then
    raise exception 'locked' using errcode = 'P0001';
  end if;

  select * into n from public.user_roadmap_nodes
  where user_roadmap_id = ur.id and version_node_id = rn.id;
  if found and n.completed_at is not null then
    return jsonb_build_object('completed', true, 'attempt_id', n.attempt_id);
  end if;

  select x.id into v_current
  from public.roadmap_version_nodes x
  left join public.user_roadmap_nodes y on y.user_roadmap_id = ur.id and y.version_node_id = x.id
  where x.version_id = ver.id and y.completed_at is null
  order by x.stage_position, x.position
  limit 1;
  if v_current is distinct from rn.id then
    raise exception 'locked' using errcode = 'P0001';
  end if;

  -- Resume the open sitting of this node, if there is one.
  select a.* into v_open from public.exam_attempts a
  where a.user_id = auth.uid() and a.roadmap_node_id = rn.id and a.status = 'in_progress';
  if found then
    perform public.attempt_touch(v_open.id);
    update public.exam_attempts set last_seen_at = now() where id = v_open.id;
    insert into public.attempt_events (attempt_id, seq, kind, at)
    values (v_open.id, v_open.current_seq, 'resume', now());
    return jsonb_build_object('completed', false, 'payload', public.attempt_payload(v_open.id));
  end if;

  select coalesce(max(attempt_no), 0) + 1 into v_no
  from public.exam_attempts where user_id = auth.uid() and exam_id = rn.exam_id;

  insert into public.exam_attempts (user_id, exam_id, version_id, attempt_no, kind, roadmap_node_id)
  values (auth.uid(), rn.exam_id, rn.exam_version_id, v_no, 'roadmap_node', rn.id)
  returning id into v_id;

  insert into public.user_roadmap_nodes (user_roadmap_id, version_node_id, attempt_id)
  values (ur.id, rn.id, v_id)
  on conflict (user_roadmap_id, version_node_id) do update set attempt_id = excluded.attempt_id;

  insert into public.attempt_events (attempt_id, seq, kind, at)
  values (v_id, 1, 'start', now());

  return jsonb_build_object('completed', false, 'payload', public.attempt_payload(v_id));
end;
$$;

revoke all on function public.roadmaps_list() from public, anon;
revoke all on function public.roadmap_detail(bigint) from public, anon;
revoke all on function public.roadmap_start(bigint) from public, anon;
revoke all on function public.roadmap_node_start(bigint) from public, anon;
grant execute on function public.roadmaps_list() to authenticated;
grant execute on function public.roadmap_detail(bigint) to authenticated;
grant execute on function public.roadmap_start(bigint) to authenticated;
grant execute on function public.roadmap_node_start(bigint) to authenticated;

-- ── the deneme analytics stay the denemeler's ───────────────────────────────
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
  where e.current_version_id is not null and e.kind = 'deneme'
  group by e.id, e.title, e.seq, v.rules, v.question_count, v.max_score, s.name
  order by e.seq;
end;
$$;

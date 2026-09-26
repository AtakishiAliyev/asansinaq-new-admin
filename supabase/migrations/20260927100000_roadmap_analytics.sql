-- Roadmap analytics: the roads as contexts, the way the denemeler are.
-- Two functions, admin-only through analytics_guard():
--   analytics_roadmaps()      one row per published road — who joined, who
--                             finished, how far the rest got, how right
--                             they were, when it was last walked
--   analytics_roadmap(id)     one road in depth — the FUNNEL down the
--                             current version's nodes (started / finished
--                             / left open, correct share, time per node),
--                             the days, the hardest questions on the road,
--                             and the students walking it
-- Everything reads the tables the student side already writes
-- (user_roadmaps, user_roadmap_nodes, exam_attempts, question_responses
-- with context_kind = 'roadmap' / context_node_id). Nothing new is
-- recorded. A student is bound to the version they started on; totals
-- count every version, the funnel is the CURRENT version's nodes and says
-- how many walkers are on it.

create or replace function public.analytics_roadmaps()
returns table (
  roadmap_id bigint,
  title text,
  program_name text,
  status text,
  version_no integer,
  stage_count smallint,
  node_count smallint,
  question_count integer,
  enrolled bigint,
  completed bigint,
  completion_pct numeric,
  avg_progress_pct numeric,
  active_7d bigint,
  avg_correct_pct numeric,
  median_days numeric,
  last_activity_at timestamptz
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
    r.id, r.title, p.name, r.status, v.version_no,
    v.stage_count, v.node_count, v.question_count,
    coalesce(e.enrolled, 0),
    coalesce(e.completed, 0),
    round(100.0 * e.completed / nullif(e.enrolled, 0), 1),
    e.avg_progress_pct,
    coalesce(act.active_7d, 0),
    resp.avg_correct_pct,
    e.median_days,
    act.last_activity_at
  from public.roadmaps r
  join public.programs p on p.id = r.program_id
  join public.roadmap_versions v on v.id = r.current_version_id
  left join lateral (
    select
      count(*) as enrolled,
      count(*) filter (where ur.completed_at is not null) as completed,
      round(avg(100.0 * (
        select count(*) from public.user_roadmap_nodes n
        where n.user_roadmap_id = ur.id and n.completed_at is not null
      ) / nullif(rv.node_count, 0)), 1) as avg_progress_pct,
      round((percentile_cont(0.5) within group (
        order by extract(epoch from ur.completed_at - ur.started_at) / 86400.0
      ) filter (where ur.completed_at is not null))::numeric, 1) as median_days
    from public.user_roadmaps ur
    join public.roadmap_versions rv on rv.id = ur.version_id
    where ur.roadmap_id = r.id
  ) e on true
  left join lateral (
    select
      count(distinct ur.user_id) filter (
        where greatest(n.started_at, n.completed_at) >= now() - interval '7 days'
      ) as active_7d,
      max(greatest(n.started_at, n.completed_at)) as last_activity_at
    from public.user_roadmaps ur
    join public.user_roadmap_nodes n on n.user_roadmap_id = ur.id
    where ur.roadmap_id = r.id
  ) act on true
  left join lateral (
    select round(100.0 * count(*) filter (where q.is_correct) / nullif(count(*), 0), 1) as avg_correct_pct
    from public.question_responses q
    where q.context_kind = 'roadmap' and q.context_id = r.id
  ) resp on true
  where r.current_version_id is not null
  order by p.name, r.sort_order, r.id;
end;
$$;

revoke all on function public.analytics_roadmaps() from public, anon;
grant execute on function public.analytics_roadmaps() to authenticated;

create or replace function public.analytics_roadmap(p_roadmap_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  out jsonb;
  v_version bigint;
begin
  perform public.analytics_guard();
  select current_version_id into v_version from public.roadmaps where id = p_roadmap_id;

  with enrolled as (
    select ur.id, ur.user_id, ur.version_id, ur.started_at, ur.completed_at,
      rv.node_count as v_nodes,
      (select count(*) from public.user_roadmap_nodes n
        where n.user_roadmap_id = ur.id and n.completed_at is not null) as done_nodes,
      (select max(greatest(n.started_at, n.completed_at)) from public.user_roadmap_nodes n
        where n.user_roadmap_id = ur.id) as last_at
    from public.user_roadmaps ur
    join public.roadmap_versions rv on rv.id = ur.version_id
    where ur.roadmap_id = p_roadmap_id
  ),
  resp as (
    select q.* from public.question_responses q
    where q.context_kind = 'roadmap' and q.context_id = p_roadmap_id
  )
  select jsonb_build_object(
    'roadmap_id', p_roadmap_id,
    'title', (select r.title from public.roadmaps r where r.id = p_roadmap_id),
    'status', (select r.status from public.roadmaps r where r.id = p_roadmap_id),
    'version_no', (select v.version_no from public.roadmap_versions v where v.id = v_version),
    'node_count', (select v.node_count from public.roadmap_versions v where v.id = v_version),
    'stage_count', (select v.stage_count from public.roadmap_versions v where v.id = v_version),
    'enrolled', (select count(*) from enrolled),
    'completed', (select count(*) from enrolled where completed_at is not null),
    'completion_pct', (select round(100.0 * count(*) filter (where completed_at is not null) / nullif(count(*), 0), 1) from enrolled),
    'avg_progress_pct', (select round(avg(100.0 * done_nodes / nullif(v_nodes, 0)), 1) from enrolled),
    'active_7d', (select count(*) from enrolled where last_at >= now() - interval '7 days'),
    'median_days', (
      select round((percentile_cont(0.5) within group (
        order by extract(epoch from completed_at - started_at) / 86400.0))::numeric, 1)
      from enrolled where completed_at is not null
    ),
    'avg_correct_pct', (select round(100.0 * count(*) filter (where is_correct) / nullif(count(*), 0), 1) from resp),
    'avg_node_time_seconds', (
      select round(avg(a.time_used_seconds), 0)
      from public.exam_attempts a
      join public.user_roadmap_nodes n on n.attempt_id = a.id
      join enrolled e on e.id = n.user_roadmap_id
      where a.status = 'submitted'
    ),
    'on_current_version', (select count(*) from enrolled where version_id = v_version),
    'funnel', (
      select coalesce(jsonb_agg(f order by f.stage_position, f.position), '[]'::jsonb) from (
        select vn.id as version_node_id, vn.stage_position, vn.stage_title, vn.position,
          vn.title, vn.kind, vn.question_count,
          (select count(*) from public.user_roadmap_nodes n where n.version_node_id = vn.id) as started,
          (select count(*) from public.user_roadmap_nodes n
            where n.version_node_id = vn.id and n.completed_at is not null) as completed,
          (select round(100.0 * count(*) filter (where q.is_correct) / nullif(count(*), 0), 1)
            from resp q where q.context_node_id = vn.id) as avg_correct_pct,
          (select round(avg(a.time_used_seconds), 0)
            from public.user_roadmap_nodes n
            join public.exam_attempts a on a.id = n.attempt_id
            where n.version_node_id = vn.id and a.status = 'submitted') as avg_time_seconds
        from public.roadmap_version_nodes vn
        where vn.version_id = v_version
      ) f
    ),
    'by_day', (
      select coalesce(jsonb_agg(t order by t.day), '[]'::jsonb) from (
        select d.day,
          (select count(*) from enrolled e where date_trunc('day', e.started_at)::date = d.day) as enrolled,
          (select count(*) from public.user_roadmap_nodes n join enrolled e on e.id = n.user_roadmap_id
            where date_trunc('day', n.completed_at)::date = d.day) as nodes_completed,
          (select count(*) from enrolled e where date_trunc('day', e.completed_at)::date = d.day) as completed
        from (
          select distinct date_trunc('day', x)::date as day from (
            select e.started_at as x from enrolled e
            union all select e.completed_at from enrolled e
            union all select n.completed_at from public.user_roadmap_nodes n
              join enrolled e on e.id = n.user_roadmap_id
          ) u where x is not null
        ) d
      ) t
    ),
    'hardest', (
      select coalesce(jsonb_agg(h order by h.correct_pct, h.responses desc), '[]'::jsonb) from (
        select q.question_id,
          max(vn.title) as node_title,
          max(vn.stage_position) as stage_position,
          max(vn.position) as position,
          max(c.name) as category_name,
          count(*) as responses,
          round(100.0 * count(*) filter (where q.is_correct) / count(*), 1) as correct_pct,
          round(100.0 * count(*) filter (where not q.is_correct and not q.is_blank) / count(*), 1) as wrong_pct,
          round(100.0 * count(*) filter (where q.is_blank) / count(*), 1) as blank_pct,
          round(avg(q.time_seconds), 0) as avg_time,
          max(q.answer) as answer,
          (select jsonb_object_agg(cc.label, cc.n) from (
            select coalesce(x.choice, '-') as label, count(*) as n
            from resp x where x.question_id = q.question_id group by coalesce(x.choice, '-')
          ) cc) as choices,
          (select count(*) from public.question_reports qr
            where qr.question_id = q.question_id and qr.status = 'open') as open_reports
        from resp q
        left join public.roadmap_version_nodes vn on vn.id = q.context_node_id
        left join public.categories c on c.id = q.category_id
        where q.question_id is not null
        group by q.question_id
        having count(*) >= 5
        order by correct_pct asc, responses desc
        limit 12
      ) h
    ),
    'students', (
      select coalesce(jsonb_agg(s order by s.last_at desc nulls last), '[]'::jsonb) from (
        select e.user_id, p.full_name, e.version_id, rv.version_no, e.started_at, e.completed_at,
          e.done_nodes, e.v_nodes as node_count, e.last_at,
          (select vn.title from public.roadmap_version_nodes vn
            where vn.version_id = e.version_id and not exists (
              select 1 from public.user_roadmap_nodes n
              where n.user_roadmap_id = e.id and n.version_node_id = vn.id and n.completed_at is not null)
            order by vn.stage_position, vn.position limit 1) as current_node_title
        from enrolled e
        join public.profiles p on p.id = e.user_id
        join public.roadmap_versions rv on rv.id = e.version_id
        order by e.last_at desc nulls last
        limit 50
      ) s
    )
  ) into out;
  return out;
end;
$$;

revoke all on function public.analytics_roadmap(bigint) from public, anon;
grant execute on function public.analytics_roadmap(bigint) to authenticated;

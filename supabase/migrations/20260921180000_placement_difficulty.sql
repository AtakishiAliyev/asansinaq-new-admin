-- The placement test now picks by DIFFICULTY, not only by topic.
--
-- Before this, a slot drew any approved question from its topic, so a
-- "çətin" slot could hand out an easy question and the twelve told us less
-- than they looked like they did. Each band now asks for its own difficulty
-- — asan 1, orta 2, çətin 3 — and falls back in a fixed order when the bank
-- cannot serve it:
--
--   1. this topic, at the band's difficulty
--   2. this topic, at ORTA — a topic with nothing hard is better represented
--      by its medium question than by an easy one from somewhere else. This
--      is live: Kümeler has 37 approved questions and not one of them is
--      hard, so its slot draws a medium Kümeler question.
--   3. another topic of the same band, at the band's difficulty
--   4. another topic of the same band, at any difficulty
--
-- One query with a priority ORDER BY rather than four, so the tiers cannot
-- drift apart, and `random()` inside each tier so the draw stays a draw.

create or replace function public.placement_start()
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
  want smallint;
  picked bigint;
  chosen bigint[] := '{}';
begin
  if (select auth.uid()) is null then
    raise exception 'not signed in';
  end if;

  for slot in select * from public.placement_blueprint order by ord loop
    want := case slot.band when 'asan' then 1 when 'orta' then 2 else 3 end;

    -- A question with a figure cannot be drawn without the figure renderer,
    -- which lives in the admin app; one with no answer cannot be scored.
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

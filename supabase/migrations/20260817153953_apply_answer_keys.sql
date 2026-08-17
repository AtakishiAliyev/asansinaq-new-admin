-- Writing printed answers onto questions.
--
-- The MATCHING (which key entry belongs to which question) happens in the
-- client, where the section inference and the operator's preview live — a
-- book whose question pages carry no test number can only be matched by
-- reading the whole book's numbering, and the operator must be able to see
-- and correct that before anything is written. So this function takes the
-- decided pairs and does one thing well: apply them atomically.
--
-- Precedence is reviewer > key > solver. A reviewer's answer is never
-- overwritten; a key may correct an earlier key (a re-parse) and always beats
-- the blind solver's guess.
create function public.apply_answer_keys(p_pairs jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_updated integer;
begin
  with pairs as (
    select (value ->> 'id')::bigint as id,
           upper(value ->> 'answer') as answer
    from jsonb_array_elements(p_pairs)
  ),
  applied as (
    update public.questions q
       set answer = p.answer,
           answer_source = 'key',
           answer_confidence = null
      from pairs p
     where q.id = p.id
       and p.answer in ('A', 'B', 'C', 'D', 'E')
       and q.answer_source is distinct from 'reviewer'
    returning 1
  )
  select count(*) into v_updated from applied;
  return v_updated;
end;
$$;

revoke execute on function public.apply_answer_keys(jsonb) from public, anon;
grant execute on function public.apply_answer_keys(jsonb) to authenticated;

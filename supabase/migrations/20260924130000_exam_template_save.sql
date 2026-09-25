-- Saving a template and its sections in one transaction.
--
-- Done from the browser as three calls (update the template, delete its
-- sections, insert the new ones), a failure between the second and the third
-- leaves a template with no sections — and every exam built from it with
-- nothing to publish against. So it is one function.
--
-- Once an exam has been built from a template, its STRUCTURE is frozen: the
-- number of sections, their order and their subjects. Those are what an
-- exam's draft is laid out against — a slot is "section 2, position 14" —
-- and changing them under a draft would strand questions in a section that no
-- longer exists. The numbers stay editable: question counts, points, penalty,
-- time, base and minimum score. Published versions are untouched either way,
-- because each one carries its own copy of the rules.
create or replace function public.exam_template_save(
  p_id bigint,
  p_template jsonb,
  p_sections jsonb
)
returns public.exam_templates
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_tpl public.exam_templates;
  v_old text;
  v_new text;
begin
  if jsonb_typeof(p_sections) is distinct from 'array'
    or jsonb_array_length(p_sections) = 0 then
    raise exception 'Şablonda ən azı bir bölmə olmalıdır';
  end if;

  if p_id is null then
    insert into public.exam_templates (
      program_id, name, name_pattern, duration_seconds, navigation,
      pause_on_exit, allow_retake, reveal_answers, base_score, min_score,
      sort_order
    )
    values (
      (p_template ->> 'program_id')::bigint,
      p_template ->> 'name',
      p_template ->> 'name_pattern',
      (p_template ->> 'duration_seconds')::integer,
      coalesce(p_template ->> 'navigation', 'free'),
      coalesce((p_template ->> 'pause_on_exit')::boolean, true),
      coalesce((p_template ->> 'allow_retake')::boolean, true),
      coalesce(p_template ->> 'reveal_answers', 'after_submit'),
      coalesce((p_template ->> 'base_score')::numeric, 0),
      coalesce((p_template ->> 'min_score')::numeric, 0),
      coalesce((
        select max(sort_order) + 1 from public.exam_templates
        where program_id = (p_template ->> 'program_id')::bigint
      ), 1)
    )
    returning * into v_tpl;
  else
    select * into v_tpl from public.exam_templates where id = p_id for update;
    if not found then
      raise exception 'Şablon tapılmadı' using errcode = 'P0002';
    end if;

    if exists (select 1 from public.exams where template_id = p_id) then
      select string_agg(s.subject_id::text, ',' order by s.position) into v_old
      from public.exam_template_sections s
      where s.template_id = p_id;
      select string_agg(x.value ->> 'subject_id', ',' order by x.ord) into v_new
      from jsonb_array_elements(p_sections) with ordinality as x (value, ord);
      if v_old is distinct from v_new then
        raise exception 'Bu şablondan deneme yaradılıb. Bölmələrin sayı, sırası və fənləri dəyişdirilə bilməz, sual sayı, bal və vaxt isə dəyişdirilə bilər.';
      end if;
    end if;

    update public.exam_templates set
      name = p_template ->> 'name',
      name_pattern = p_template ->> 'name_pattern',
      duration_seconds = (p_template ->> 'duration_seconds')::integer,
      navigation = coalesce(p_template ->> 'navigation', navigation),
      pause_on_exit = coalesce((p_template ->> 'pause_on_exit')::boolean, pause_on_exit),
      allow_retake = coalesce((p_template ->> 'allow_retake')::boolean, allow_retake),
      reveal_answers = coalesce(p_template ->> 'reveal_answers', reveal_answers),
      base_score = coalesce((p_template ->> 'base_score')::numeric, base_score),
      min_score = coalesce((p_template ->> 'min_score')::numeric, min_score)
    where id = p_id
    returning * into v_tpl;

    delete from public.exam_template_sections where template_id = p_id;
  end if;

  insert into public.exam_template_sections (
    template_id, program_id, position, subject_id, question_count,
    duration_seconds, points_correct, penalty_ratio
  )
  select
    v_tpl.id,
    v_tpl.program_id,
    x.ord,
    (x.value ->> 'subject_id')::bigint,
    (x.value ->> 'question_count')::smallint,
    nullif(x.value ->> 'duration_seconds', '')::integer,
    (x.value ->> 'points_correct')::numeric,
    coalesce((x.value ->> 'penalty_ratio')::numeric, 0)
  from jsonb_array_elements(p_sections) with ordinality as x (value, ord);

  return v_tpl;
end;
$$;

revoke all on function public.exam_template_save(bigint, jsonb, jsonb) from public, anon;
grant execute on function public.exam_template_save(bigint, jsonb, jsonb) to authenticated;

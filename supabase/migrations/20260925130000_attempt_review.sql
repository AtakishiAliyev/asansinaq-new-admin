-- The answer review: what was asked, what was chosen, what was right.
--
-- The one call that hands a student an ANSWER KEY, so it is gated three
-- ways: the attempt must be theirs, it must be handed in, and the version
-- must allow it (`reveal_answers`, a template setting — "never" is an exam
-- whose key the school keeps). The first opening is recorded on the
-- attempt (`answers_revealed_at`) and in the event log: a retake after the
-- key was seen is a different kind of sitting, and analytics will want to
-- tell the two apart.
--
-- Per question it returns what the runner had — seq, section, stem,
-- options, figures — plus the key and the student's choice, so the review
-- screen is the exam screen read back with two more facts, and every
-- verdict (correct / wrong / blank) is derived in one place from those two.
create or replace function public.attempt_review(p_attempt_id bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  a public.exam_attempts;
  v public.exam_versions;
begin
  select * into a
  from public.exam_attempts
  where id = p_attempt_id and user_id = auth.uid();
  if not found or a.status <> 'submitted' then
    raise exception 'Cəhd tapılmadı' using errcode = 'P0002';
  end if;

  select * into v from public.exam_versions where id = a.version_id;
  if coalesce(v.rules ->> 'reveal_answers', 'after_submit') <> 'after_submit' then
    raise exception 'answers_hidden' using errcode = 'P0003';
  end if;

  if a.answers_revealed_at is null then
    update public.exam_attempts set answers_revealed_at = now() where id = a.id;
    insert into public.attempt_events (attempt_id, kind, at)
    values (a.id, 'review_open', now());
  end if;

  return jsonb_build_object(
    'attempt_id', a.id,
    'questions', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'seq', i.seq,
          'section_position', i.section_position,
          'stem', i.stem,
          'options', i.options,
          'figures', i.figures,
          'answer', i.answer,
          'choice', r.choice
        )
        order by i.seq
      ), '[]'::jsonb)
      from public.exam_version_items i
      left join public.attempt_responses r
        on r.attempt_id = a.id and r.seq = i.seq
      where i.version_id = a.version_id
    )
  );
end;
$$;

revoke all on function public.attempt_review(bigint) from public, anon;
grant execute on function public.attempt_review(bigint) to authenticated;

-- Which flags the work screen's rows carry, and how many of each.
--
-- The screen's only cut through flagged rows was Diqqət/Təmiz, which puts a
-- crop missing its fifth answer, a verdict the wave disputed and a duplicate
-- option in one pile. The operator's actual work runs by CODE: after a
-- segmenter fix, "every option_count row, re-queue them"; before a review
-- session, "every verify_mismatch". Counting client-side would cap at
-- PostgREST's thousand-row page and under-report, the same defect the status
-- counts were moved server-side to avoid.
--
-- Grouped by code AND level rather than code alone: one code can stand at
-- two levels (verify_mismatch is an error when a critical difference was
-- named and a warning otherwise), and the client decides how to show that.
--
-- `security invoker`, so the table's RLS applies and a non-admin caller sees
-- nothing — the same shape as the other read functions on this table.
create or replace function public.question_flag_counts(
  p_book_id bigint default null,
  p_status text default null
)
returns table (code text, level text, n bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select f->>'code' as code, f->>'level' as level, count(*)::bigint as n
  from public.questions q
  cross join lateral jsonb_array_elements(q.flags) as f
  where q.status <> 'approved'
    and (p_book_id is null or q.book_id = p_book_id)
    and (p_status is null or q.status = p_status)
  group by 1, 2
  order by n desc, code;
$$;

revoke all on function public.question_flag_counts(bigint, text) from public, anon;
grant execute on function public.question_flag_counts(bigint, text) to authenticated;

-- The list filters on `flags @> '[{"code": …}]'`. Without an index that is a
-- sequential scan over a table meant to reach five figures; jsonb_path_ops is
-- the smaller of the two GIN variants and supports exactly that operator.
create index if not exists questions_flags_gin
  on public.questions using gin (flags jsonb_path_ops);

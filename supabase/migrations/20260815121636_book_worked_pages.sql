-- Processing trail: which pages of a book have been segmented at least once.
-- Turns the books list into a work dashboard ("12/425 done, continue from 13")
-- instead of a bare file archive.

alter table public.books
  add column worked_pages integer[] not null default '{}';

-- Atomic merge — two overlapping runs must not lose each other's pages.
-- SECURITY INVOKER on purpose: the UPDATE runs as the caller, so the books
-- update RLS policy (is_admin) is the gate.
create function public.mark_pages_worked(p_book_id bigint, p_pages integer[])
returns void
language sql
set search_path = ''
as $$
  update public.books
  set worked_pages = (
    select coalesce(array_agg(distinct p order by p), '{}')
    from unnest(worked_pages || p_pages) as t(p)
  )
  where id = p_book_id;
$$;

revoke execute on function public.mark_pages_worked(bigint, integer[]) from public, anon;
grant execute on function public.mark_pages_worked(bigint, integer[]) to authenticated;

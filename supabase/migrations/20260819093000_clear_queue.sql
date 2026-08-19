-- Emptying the queue, without destroying the evidence that a batch is in flight.
--
-- "Boşalt" was a plain update that nulled queued_at AND claimed_at on every
-- queued row, including the batch a worker was actively paying for. No worker
-- could re-claim those rows directly — claim_questions requires queued_at — but
-- the lease was gone, so the very next "Növbəyə at" on the same questions saw
-- claimed_at = null, queued them, and a second worker started paying for work
-- the first had not finished. enqueue_questions was written precisely to avoid
-- that; clearing the queue must not undo it.
--
-- Rows under a live lease are therefore left alone. They leave the queue on
-- their own when the worker finishes them, and the count of what was skipped
-- goes back to the caller so the UI can say so instead of implying the queue
-- is empty.
create or replace function public.clear_queue()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  cleared integer;
  held    integer;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  select count(*) into held
    from public.questions
   where queued_at is not null
     and claimed_at is not null
     and claimed_at >= now() - public.queue_lease();

  update public.questions
     set queued_at = null,
         claimed_at = null
   where queued_at is not null
     and (claimed_at is null or claimed_at < now() - public.queue_lease());

  get diagnostics cleared = row_count;
  return jsonb_build_object('cleared', cleared, 'held', held);
end;
$$;

revoke all on function public.clear_queue() from public, anon;
grant execute on function public.clear_queue() to authenticated;

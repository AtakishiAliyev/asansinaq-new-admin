-- A re-read has no verdict yet, so putting a row back in the queue must clear
-- the one it had.
--
-- `verified_at` arrived a day after this function was last written, and the
-- function never learned about it. So a row that had PASSED verification and
-- was then re-queued from the UI was re-extracted, written back with
-- `verified = false` (correct: the new content is unread) and `verified_at`
-- still set (wrong: that timestamp belongs to the old content). The verify
-- wave selects on `verified_at is null`, so it never looked at the row again,
-- and the row sat in the Diqqət lane with no path out except a hand edit.
-- `scripts/requeue.ts` clears the column; the button in the UI did not.
--
-- `prev_version` goes too: `repair_round` is reset here already, and a parked
-- version from an earlier repair chain would otherwise be compared against the
-- first read of the new chain.
create or replace function public.enqueue_questions(p_ids bigint[])
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  queued integer;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  update public.questions
     set queued_at = now(),
         claimed_at = null,
         claimed_by_worker = null,
         lease_until = null,
         batch_id = null,
         batch_custom_id = null,
         batch_stage = null,
         repair_round = 0,
         attempts = 0,
         verified = false,
         verified_at = null,
         verify_confidence = null,
         verify_diff = null,
         prev_version = null
   where id = any(p_ids)
     and public.claim_expired(claimed_at, lease_until);

  get diagnostics queued = row_count;
  return queued;
end;
$$;

revoke all on function public.enqueue_questions(bigint[]) from public, anon;
grant execute on function public.enqueue_questions(bigint[]) to authenticated;

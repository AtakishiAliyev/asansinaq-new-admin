-- Where the verification wave writes its answer.
--
-- `verified` already exists and already drives `needs_attention`, so a row that
-- passes leaves the Diqqət lane on its own — that column is generated and needs
-- no help. What is missing is everything a reviewer needs to act on a row that
-- did NOT pass: how sure the comparison was, and what it actually saw.
--
-- The diff is stored structured rather than folded into `flags` because the two
-- answer different questions. `flags` is "what is wrong with this row" and is
-- read by auto-approve; the diff is "what the verifier saw when it looked",
-- which stays interesting even for a row that passed.
alter table public.questions
  add column verify_confidence real check (verify_confidence between 0 and 1),
  add column verify_diff jsonb,
  add column verified_at timestamptz;

comment on column public.questions.verify_confidence is
  'How sure the render-and-compare wave was about ITS COMPARISON — not the question''s difficulty.';
comment on column public.questions.verify_diff is
  'What the verifier saw: [{field, severity, note}]. Kept for rows that passed too, so a later dispute has evidence.';
comment on column public.questions.verified_at is
  'When the verification wave last ruled on this row. Null means it never has.';

-- The wave's own work list: structured, not yet ruled on, not already in flight.
-- Partial because it is a small slice of a table meant to reach five figures,
-- and it empties as the wave runs.
create index questions_awaiting_verify_idx
  on public.questions (id)
  where status = 'structured' and verified_at is null;

-- What earlier runs learned about a book, so the next question does not
-- rediscover it.
--
-- The agent starts every question from nothing: the same watermark, the same
-- printed option letters, the same house style for figures, learned again on
-- question one and question four hundred. That is paid for every time. These
-- notes are the agent's long-term memory for one book — short, durable
-- statements that will still be true on the next page.
--
-- Deliberately on `books`, not on `questions`: a note that only applies to one
-- question is not a note, it is that question's `flags`.
alter table public.books
  add column agent_notes jsonb not null default '[]'::jsonb;

comment on column public.books.agent_notes is
  'Durable notes about this book, written by the agent and by reviewers, injected into later agent runs. Array of {text, from, at}.';

-- A runaway loop must not be able to grow a row without bound, and a prompt
-- built from this has to stay small enough to send every turn.
alter table public.books
  add constraint books_agent_notes_bounded
  check (jsonb_typeof(agent_notes) = 'array' and jsonb_array_length(agent_notes) <= 20);

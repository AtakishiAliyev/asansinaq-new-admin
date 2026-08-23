-- Remove the agent's per-book memory.
--
-- `books.agent_notes` was added for the browser-driven agent loop on the
-- `agent-probe` branch, which is abandoned. The two migrations from that branch
-- had been pushed to the hosted project without ever landing on `main`, so the
-- schema and the repo had drifted apart — the failure `config.toml` discipline
-- exists to prevent, arriving through migrations instead. The previous two
-- files record what actually ran; this one removes the half we are not keeping.
--
-- `ops_log.cached_tokens` stays, and is now load bearing for a different
-- reason than it was written for: the batch pipeline caches a large fixed
-- prefix on every call, and a cost column we compute ourselves cannot show
-- whether that is working. It is the only evidence that prompt caching is
-- actually happening.
--
-- Dropping the column takes `books_agent_notes_bounded` with it. No book had a
-- note, so nothing is lost.
alter table public.books
  drop column if exists agent_notes;

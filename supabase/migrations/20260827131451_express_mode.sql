-- Express mode: synchronous calls for a set small enough to watch.
--
-- Batch is half price and stays the default, but its latency does not scale
-- down. A measured run of eight questions spent 935 of its 1099 seconds waiting
-- in the provider's queue across two waves, and a batch of one waits as long as
-- a batch of fifty. For a small set an operator is sitting in front of, paying
-- full price to skip that queue is the better trade.

-- The operator's override. The worker also enters express on its own when the
-- queued set is small (EXPRESS_THRESHOLD), so this is for the other case: a set
-- above the threshold that someone is waiting on anyway.
alter table public.worker_control
  add column if not exists express boolean not null default false;

comment on column public.worker_control.express is
  'Operator override: run synchronously at full price even when the queued set '
  'is large enough that batch would normally be chosen. The worker enters '
  'express on its own for small sets regardless of this flag.';

-- Which lane a logged call actually went down.
--
-- The cost column has always been computed with the batch discount applied or
-- not, but the FACT was thrown away — so a ledger row could not say whether it
-- was cheap because it was batched or expensive because it was not. Nullable
-- with no default on purpose: rows written before this column existed did not
-- record it, and defaulting them to either value would invent a history. Null
-- means "not recorded", which is true.
alter table public.ops_log
  add column if not exists via_batch boolean;

comment on column public.ops_log.via_batch is
  'True = Message Batches API (half price). False = synchronous (express). '
  'Null = written before the column existed; not recorded.';

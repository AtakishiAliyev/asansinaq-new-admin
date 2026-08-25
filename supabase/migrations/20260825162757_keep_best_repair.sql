-- Keep the best version a repair round produced, not the last one.
--
-- A repair re-reads the crop and overwrites the row, and until now that was
-- unconditional: a second read that came back WORSE replaced a better one, and
-- the only evidence it had been better was a confidence number that had already
-- been overwritten too. The figure that lost its congruence marks on a repair
-- is the case this closes.
--
-- The comparison cannot be made at extraction time — the confidence of a read
-- is only known after the verification wave rules on it — so the version being
-- replaced is parked here until its replacement has been judged.
alter table public.questions
  add column if not exists prev_version jsonb;

comment on column public.questions.prev_version is
  'The stem/options/figures and verify score of the version a repair round is '
  'replacing, held until the new version has been verified. Restored over the '
  'new one when the repair scored worse, then cleared. Null outside a repair.';

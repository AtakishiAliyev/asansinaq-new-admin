-- Difficulty on three levels, and one column to read it from.
--
-- Five levels were too fine for the model to use: over a live bank it chose 2
-- or 3 for every question and nothing else, which is a scale with two working
-- values dressed as five. Three — asan, orta, çətin — is what the operator
-- actually wants to filter on, and a model forced to pick one of three spreads
-- its answers where one asked for one of five hedges to the middle.
--
-- The remap folds the old scale onto the new one: 1,2 → asan, 3 → orta,
-- 4,5 → çətin. It runs BEFORE the new checks are added, or the checks would
-- refuse the rows they are meant to govern.
alter table public.questions
  drop constraint if exists questions_ai_difficulty_check,
  drop constraint if exists questions_reviewer_difficulty_check;

update public.questions
set
  ai_difficulty = case
    when ai_difficulty is null then null
    when ai_difficulty <= 2 then 1
    when ai_difficulty = 3 then 2
    else 3
  end,
  reviewer_difficulty = case
    when reviewer_difficulty is null then null
    when reviewer_difficulty <= 2 then 1
    when reviewer_difficulty = 3 then 2
    else 3
  end
where ai_difficulty is not null or reviewer_difficulty is not null;

alter table public.questions
  add constraint questions_ai_difficulty_check
    check (ai_difficulty between 1 and 3),
  add constraint questions_reviewer_difficulty_check
    check (reviewer_difficulty between 1 and 3);

-- The value a screen shows and a filter matches. A GENERATED column, like
-- `needs_attention`, rather than a copy the app maintains: every writer of
-- either input gets it for free and none of them can forget.
--
-- It exists because the ready screen read `reviewer_difficulty` alone, on the
-- reasoning that approval writes whatever the reviewer had in front of them.
-- Auto-approval writes no such thing — the sweep sets the status and nothing
-- else — so every question the rule approved showed no difficulty at all,
-- while `ai_difficulty` sat filled in beside it. The reviewer's pick wins when
-- there is one; the model's stands until then.
alter table public.questions
  add column difficulty smallint
  generated always as (coalesce(reviewer_difficulty, ai_difficulty)) stored;

comment on column public.questions.difficulty is
  'Generated: the reviewer''s difficulty where set, else the model''s. 1 asan, 2 orta, 3 çətin.';
comment on column public.questions.ai_difficulty is
  'The model''s estimate, 1 asan / 2 orta / 3 çətin. Required of every read.';
comment on column public.questions.reviewer_difficulty is
  'A person''s override, same scale. Null until someone chooses; read through `difficulty`.';

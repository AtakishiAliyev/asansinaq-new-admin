-- The top goal is 450+, not 500. A "500" option reads as "only for people
-- who want a perfect score" and nobody picks it; "450+" is the band every
-- strong candidate is actually aiming at. No row holds 500 yet — the
-- onboarding shipped today — so the constraint simply moves.

alter table public.profiles drop constraint profiles_goal_score_check;
alter table public.profiles add constraint profiles_goal_score_check
  check (goal_score is null or goal_score in (300, 400, 450));
comment on column public.profiles.goal_score is
  'TR-YÖS target band the student picked at onboarding: 300, 400 or 450.';

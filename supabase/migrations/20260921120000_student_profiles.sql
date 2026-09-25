-- Students arrive.
--
-- Until now every auth user was an admin, provisioned by hand, and `profiles`
-- was read and written only behind is_admin(). The student app signs people
-- up by themselves (signup is enabled in config.toml in the same change), so
-- the row a student gets from handle_new_user() has to be theirs to read and
-- to fill in — and nobody else's. Admin access is untouched: it never rested
-- on signup being closed, only on admin_emails + is_admin().
--
-- What a student tells us before the first question is the goal and the
-- grade. Both are asked BEFORE the account exists, so they cannot be written
-- by a trigger; the app writes them the moment the code is verified.
-- `onboarded_at` is what the app reads to decide whether to show the
-- onboarding again.

alter table public.profiles
  add column goal_score smallint,
  add column grade text,
  add column onboarded_at timestamptz,
  add constraint profiles_goal_score_check
    check (goal_score is null or goal_score in (300, 400, 500)),
  add constraint profiles_grade_check
    check (grade is null or grade in ('9', '10', '11', 'graduate'));

comment on column public.profiles.goal_score is
  'TR-YÖS target the student picked at onboarding: 300, 400 or 500.';
comment on column public.profiles.grade is
  'School grade at onboarding: 9, 10, 11 or graduate.';

-- Own-row access for every signed-in user. The admin-wide policies stay; a
-- policy set is OR-ed, so an admin still sees every row and a student sees
-- exactly one.
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

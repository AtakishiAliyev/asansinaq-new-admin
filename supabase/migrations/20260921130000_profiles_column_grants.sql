-- A student may update their own row — and only the four columns that are
-- theirs to say. RLS decides WHICH row; this decides WHICH COLUMNS, and it
-- is the part that has to hold when a column is added later: a `credits`
-- or `role` column on profiles must not be writable by the person it
-- describes, and with a table-wide UPDATE grant it would be, silently.
-- Column-level grants fail closed — a new column is unwritable until it is
-- named here.

revoke update on public.profiles from authenticated;
grant update (full_name, goal_score, grade, onboarded_at)
  on public.profiles to authenticated;

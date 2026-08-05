-- Who may use the admin panel. This is configuration data, not schema, so it
-- lives here rather than in a migration: the list changes over time, and
-- migration history is not the place for a growing roster of addresses.
--
-- Seeds run on `supabase db reset` (local). They do NOT run on `db push`, so a
-- freshly created hosted project needs this statement executed once by hand —
-- otherwise nobody can get past the login screen.
insert into public.admin_emails (email, note)
values ('atas.eliyev45@gmail.com', 'owner')
on conflict (email) do nothing;

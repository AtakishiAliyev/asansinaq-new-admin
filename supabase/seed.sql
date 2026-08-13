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

-- The starting taxonomy: the YÖS exam system and its three subjects. All of it
-- is editable through the admin panel afterwards; this only guarantees a fresh
-- environment is not empty.
insert into public.programs (name)
values ('YÖS')
on conflict do nothing;

insert into public.subjects (program_id, name, sort_order)
select p.id, s.name, s.ord
from public.programs p
join (values ('Matematik', 1), ('Geometri', 2), ('Mantık', 3)) as s (name, ord) on true
where lower(p.name) = 'yös'
on conflict do nothing;

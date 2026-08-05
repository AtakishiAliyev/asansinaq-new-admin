-- Admin access foundation.
--
-- There are no roles. A fixed allowlist of email addresses decides who may use
-- the admin panel, and every RLS policy in this database resolves access
-- through public.is_admin(). Removing a row therefore revokes access on the
-- next request rather than when the session eventually expires.

create table public.admin_emails (
  email text primary key,
  note text,
  created_at timestamptz not null default now(),
  constraint admin_emails_is_lowercase check (email = lower(email)),
  constraint admin_emails_looks_like_email
    check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);

comment on table public.admin_emails is
  'Allowlist of admin panel users. Deliberately has no write policy: rows are managed through supabase/seed.sql or the dashboard, never through the client.';

-- security definer so the lookup bypasses this table's own RLS, which would
-- otherwise recurse. It takes no arguments and reports only on its caller, so
-- exposing it to authenticated clients leaks nothing — the login screen calls
-- it to render an explicit "not authorized" state instead of an empty panel.
create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.admin_emails
    where email = lower(auth.jwt() ->> 'email')
  );
$$;

revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

alter table public.admin_emails enable row level security;

create policy admin_emails_select on public.admin_emails
  for select
  to authenticated
  using ((select public.is_admin()));

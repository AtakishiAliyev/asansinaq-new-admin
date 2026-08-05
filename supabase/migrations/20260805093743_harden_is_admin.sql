-- Bind admin status to the authenticated user row instead of the JWT's email
-- string. Both resolve to the same thing today, but the claim is a value we are
-- handed, while auth.uid() -> auth.users is a fact we look up — so a future
-- custom-claims hook or a crafted token cannot talk its way into the allowlist.
-- Requiring email_confirmed_at also states in SQL what the panel assumes:
-- an admin is someone who has proven they own the address.
--
-- These auth settings remain security-critical. Do not relax one without
-- re-auditing this function:
--   disable_signup = true                     (nobody can self-provision)
--   mailer_autoconfirm = false                (ownership must be proven)
--   mailer_secure_email_change_enabled = true (an email change needs the new
--                                              mailbox to confirm, so a user
--                                              cannot rename into the allowlist)
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    join public.admin_emails a on a.email = lower(u.email)
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
  );
$$;

-- Admin profiles and the question-bank taxonomy.
--
-- Taxonomy shape: programs (YÖS, later SAT) → subjects (Matematik, Geometri,
-- Mantık) → categories, where a category may have one level of sub-categories
-- (parent_id). Adding a new exam system later is an INSERT into programs, not
-- a schema change. Questions will reference categories with ON DELETE RESTRICT
-- when they arrive; nothing references them yet.

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── profiles ────────────────────────────────────────────────────────────────
-- Identity/display info for a signed-in admin. Access is still decided solely
-- by admin_emails + is_admin(); a future role column would live here or there.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_full_name_length check (char_length(full_name) <= 120)
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Runs as the function owner (postgres), so it works no matter which internal
-- role inserts the auth user (admin API, invite, dashboard).
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

insert into public.profiles (id)
select id from auth.users
on conflict (id) do nothing;

alter table public.profiles enable row level security;

create policy profiles_select on public.profiles
  for select to authenticated
  using ((select public.is_admin()));

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) and (select public.is_admin()))
  with check (id = (select auth.uid()) and (select public.is_admin()));

-- ── programs ────────────────────────────────────────────────────────────────

create table public.programs (
  id bigint generated always as identity primary key,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint programs_name_not_blank check (btrim(name) <> ''),
  constraint programs_name_length check (char_length(name) <= 80)
);

create unique index programs_name_key on public.programs (lower(name));

create trigger programs_set_updated_at
  before update on public.programs
  for each row execute function public.set_updated_at();

-- ── subjects ────────────────────────────────────────────────────────────────
-- ON DELETE RESTRICT: deleting a whole program must be a deliberate,
-- subject-by-subject act, never one accidental click.

create table public.subjects (
  id bigint generated always as identity primary key,
  program_id bigint not null references public.programs (id) on delete restrict,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subjects_name_not_blank check (btrim(name) <> ''),
  constraint subjects_name_length check (char_length(name) <= 80)
);

-- Doubles as the FK index (program_id is the leading column).
create unique index subjects_program_name_key
  on public.subjects (program_id, lower(name));

create trigger subjects_set_updated_at
  before update on public.subjects
  for each row execute function public.set_updated_at();

-- ── categories ──────────────────────────────────────────────────────────────
-- One table for both levels: a row with parent_id is a sub-category. Questions
-- will point at a single category_id regardless of level.

create table public.categories (
  id bigint generated always as identity primary key,
  subject_id bigint not null references public.subjects (id) on delete cascade,
  parent_id bigint,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint categories_name_not_blank check (btrim(name) <> ''),
  constraint categories_name_length check (char_length(name) <= 120),
  constraint categories_no_self_parent check (parent_id <> id)
);

-- Lets the composite FK below assert "my parent is in MY subject" without a
-- trigger: the referenced pair must exist, so a parent from another subject
-- simply has no matching (id, subject_id) row.
create unique index categories_id_subject_key
  on public.categories (id, subject_id);

alter table public.categories
  add constraint categories_parent_same_subject
  foreign key (parent_id, subject_id)
  references public.categories (id, subject_id)
  on delete cascade;

-- Sibling names are unique within their level; 0 stands in for "root" so the
-- expression index can cover both cases.
create unique index categories_sibling_name_key
  on public.categories (subject_id, coalesce(parent_id, 0), lower(name));

create index categories_parent_id_idx on public.categories (parent_id);

create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function public.set_updated_at();

-- Depth is capped at two levels for now. UI relies on this; lifting the cap
-- later is deleting this trigger, not a schema change.
create function public.enforce_category_depth()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.parent_id is not null and exists (
    select 1 from public.categories
    where id = new.parent_id and parent_id is not null
  ) then
    raise exception 'sub-kateqoriyanın öz sub-kateqoriyası ola bilməz'
      using errcode = 'check_violation';
  end if;

  if new.parent_id is not null and exists (
    select 1 from public.categories where parent_id = new.id
  ) then
    raise exception 'sub-kateqoriyaları olan kateqoriya özü sub ola bilməz'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger categories_enforce_depth
  before insert or update of parent_id on public.categories
  for each row execute function public.enforce_category_depth();

-- ── access ──────────────────────────────────────────────────────────────────
-- Admin-only tables: anon loses even the default table grants, so requests
-- without a session fail at the privilege layer before RLS is consulted.

revoke all on public.programs, public.subjects, public.categories, public.profiles from anon;
grant select, insert, update, delete
  on public.programs, public.subjects, public.categories to authenticated;
grant select, update on public.profiles to authenticated;

alter table public.programs enable row level security;
alter table public.subjects enable row level security;
alter table public.categories enable row level security;

create policy programs_select on public.programs
  for select to authenticated using ((select public.is_admin()));
create policy programs_insert on public.programs
  for insert to authenticated with check ((select public.is_admin()));
create policy programs_update on public.programs
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy programs_delete on public.programs
  for delete to authenticated using ((select public.is_admin()));

create policy subjects_select on public.subjects
  for select to authenticated using ((select public.is_admin()));
create policy subjects_insert on public.subjects
  for insert to authenticated with check ((select public.is_admin()));
create policy subjects_update on public.subjects
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy subjects_delete on public.subjects
  for delete to authenticated using ((select public.is_admin()));

create policy categories_select on public.categories
  for select to authenticated using ((select public.is_admin()));
create policy categories_insert on public.categories
  for insert to authenticated with check ((select public.is_admin()));
create policy categories_update on public.categories
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy categories_delete on public.categories
  for delete to authenticated using ((select public.is_admin()));

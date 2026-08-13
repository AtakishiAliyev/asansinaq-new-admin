-- Trim names at the database, not just in the client's zod schema. The client
-- is untrusted: a direct PostgREST insert with a valid admin JWT would
-- otherwise store 'Geometriya ' next to 'Geometriya' as distinct siblings,
-- since the unique indexes key on lower(name), not lower(btrim(name)).

create function public.trim_name()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name = btrim(new.name);
  return new;
end;
$$;

create trigger programs_trim_name
  before insert or update of name on public.programs
  for each row execute function public.trim_name();

create trigger subjects_trim_name
  before insert or update of name on public.subjects
  for each row execute function public.trim_name();

create trigger categories_trim_name
  before insert or update of name on public.categories
  for each row execute function public.trim_name();

-- Canonicalize any rows that predate the triggers.
update public.programs set name = btrim(name) where name <> btrim(name);
update public.subjects set name = btrim(name) where name <> btrim(name);
update public.categories set name = btrim(name) where name <> btrim(name);

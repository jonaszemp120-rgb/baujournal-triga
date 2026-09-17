-- Row Level Security: nur eingeloggte Nutzer, kein anonymer Zugriff.
-- Alle Teammitglieder sehen alle Projekte und duerfen ueberall erfassen,
-- es gibt bewusst keine Rollen.

alter table public.profile               enable row level security;
alter table public.projekte              enable row level security;
alter table public.eintraege             enable row level security;
alter table public.eintraege_korrekturen enable row level security;

-- profile: alle lesen, jeder pflegt nur den eigenen Namen
create policy profile_select on public.profile
  for select to authenticated using (true);
create policy profile_update_eigen on public.profile
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy profile_insert_eigen on public.profile
  for insert to authenticated with check (id = auth.uid());

-- projekte: lesen, anlegen, bearbeiten. Kein delete, archiviert wird
-- ueber das Flag archiviert, wegen Garantie- und Verjaehrungsfristen.
create policy projekte_select on public.projekte
  for select to authenticated using (true);
create policy projekte_insert on public.projekte
  for insert to authenticated with check (auth.uid() is not null);
create policy projekte_update on public.projekte
  for update to authenticated using (true) with check (true);

-- eintraege: lesen, erfassen, korrigieren. Kein delete, ein Baujournal
-- dient im Streitfall als Beweismittel.
create policy eintraege_select on public.eintraege
  for select to authenticated using (true);
create policy eintraege_insert on public.eintraege
  for insert to authenticated with check (auth.uid() is not null);
create policy eintraege_update on public.eintraege
  for update to authenticated using (true) with check (true);

-- Korrekturprotokoll: nur lesen und anhaengen, nie aendern oder loeschen.
create policy korrekturen_select on public.eintraege_korrekturen
  for select to authenticated using (true);
create policy korrekturen_insert on public.eintraege_korrekturen
  for insert to authenticated with check (geaendert_von = auth.uid());

-- Anzeigename automatisch anlegen, sobald im Dashboard ein Konto entsteht.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  anzeige text;
begin
  anzeige := coalesce(
    nullif(trim(new.raw_user_meta_data->>'name'), ''),
    nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
    initcap(replace(split_part(new.email, '@', 1), '.', ' ')),
    new.email
  );
  insert into public.profile (id, name) values (new.id, anzeige)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Konten, die schon vor dem Trigger bestanden, nachtragen.
insert into public.profile (id, name)
select u.id,
       coalesce(
         nullif(trim(u.raw_user_meta_data->>'name'), ''),
         initcap(replace(split_part(u.email, '@', 1), '.', ' ')),
         u.email)
from auth.users u
on conflict (id) do nothing;

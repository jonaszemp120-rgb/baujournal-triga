-- Bereich Mitarbeiter.
--
-- Bewusst voellig unabhaengig von auth.users: ein Eintrag hier ist ein
-- Adressbucheintrag, kein Konto. Es gibt keinen Fremdschluessel auf
-- auth.users fuer die Person selbst, nur fuer die Spuren wer angelegt
-- und wer geloescht hat. Einen Mitarbeiter in den Papierkorb zu legen
-- kann das zugehoerige Login also gar nicht beruehren. Konten legt
-- weiterhin nur das Dashboard an.

create table if not exists public.mitarbeiter (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  rolle         text,
  telefon       text,
  email         text,
  geloescht_am  timestamptz,
  geloescht_von uuid references auth.users(id) on delete set null,
  erstellt_von  uuid references auth.users(id) on delete set null,
  erstellt_am   timestamptz not null default now()
);

create index if not exists mitarbeiter_aktiv_idx
  on public.mitarbeiter (name) where geloescht_am is null;

-- Die Loeschspur setzt die Datenbank, nicht der Client. Sonst koennte
-- jemand einen fremden Namen als Loescher eintragen. Dieselbe Funktion
-- bedient spaeter auch Firmen, Ordner und Dateien.
create or replace function public.setze_loeschspur()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.geloescht_am is distinct from old.geloescht_am then
    if new.geloescht_am is null then
      new.geloescht_von := null;
    else
      new.geloescht_am  := now();
      new.geloescht_von := auth.uid();
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.setze_loeschspur() from public, anon, authenticated;

drop trigger if exists mitarbeiter_loeschspur on public.mitarbeiter;
create trigger mitarbeiter_loeschspur
  before update on public.mitarbeiter
  for each row execute function public.setze_loeschspur();

-- Row Level Security wie ueberall: nur eingeloggte Nutzer, kein
-- anonymer Zugriff, und keine delete-Policy. Geloescht wird ueber
-- geloescht_am, zurueckgeholt ueber den Papierkorb.
alter table public.mitarbeiter enable row level security;

create policy mitarbeiter_select on public.mitarbeiter
  for select to authenticated using (true);
create policy mitarbeiter_insert on public.mitarbeiter
  for insert to authenticated with check (auth.uid() is not null);
create policy mitarbeiter_update on public.mitarbeiter
  for update to authenticated using (true) with check (true);

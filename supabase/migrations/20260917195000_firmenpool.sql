-- Bereich Firmenpool.
--
-- Die BKP-Kategorien sind Daten, nicht Programmcode: anlegbar,
-- bearbeitbar und loeschbar wie alles andere.
create table if not exists public.bkp_liste (
  id            uuid primary key default gen_random_uuid(),
  code          text not null,
  bezeichnung   text,
  geloescht_am  timestamptz,
  geloescht_von uuid references auth.users(id) on delete set null,
  erstellt_von  uuid references auth.users(id) on delete set null,
  erstellt_am   timestamptz not null default now()
);
create unique index if not exists bkp_code_eindeutig
  on public.bkp_liste (code) where geloescht_am is null;

-- Nur der Name ist Pflicht. Alles andere darf fehlen, sonst traegt am
-- Ende niemand etwas ein.
create table if not exists public.firmen (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  adresse       text,
  plz_ort       text,
  telefon       text,
  email         text,
  -- Die BKP-Codes als Liste von Strings, passend zu bkp_liste.code.
  bkp_codes     jsonb not null default '[]'::jsonb,
  geloescht_am  timestamptz,
  geloescht_von uuid references auth.users(id) on delete set null,
  erstellt_von  uuid references auth.users(id) on delete set null,
  erstellt_am   timestamptz not null default now()
);

-- Ansprechpersonen gehoeren zu genau einer Firma. Hier gibt es bewusst
-- keinen Papierkorb: ein Unterdetail, kein Datensatz mit Beweischarakter,
-- eine falsch geloeschte Person ist in Sekunden neu erfasst.
create table if not exists public.ansprechpersonen (
  id           uuid primary key default gen_random_uuid(),
  firma_id     uuid not null references public.firmen(id) on delete cascade,
  name         text not null,
  funktion     text,
  telefon      text,
  email        text,
  erstellt_von uuid references auth.users(id) on delete set null,
  erstellt_am  timestamptz not null default now()
);

-- Notizen mit Ampelfarbe. Die Farbe der juengsten Notiz ist die aktuelle
-- Einstufung der Firma, eine separate manuelle Einstufung braucht es
-- nicht. Kein Korrekturprotokoll, das ist hier bewusst nicht noetig.
create table if not exists public.notizen (
  id          uuid primary key default gen_random_uuid(),
  firma_id    uuid not null references public.firmen(id) on delete cascade,
  text        text not null,
  farbe       text not null default 'gruen'
                check (farbe in ('rot', 'gelb', 'gruen')),
  autor_id    uuid references auth.users(id) on delete set null,
  erstellt_am timestamptz not null default now()
);

-- Unterstuetzende Tabelle: welche Firma war auf welchem Projekt im
-- Einsatz. Noch ohne eigene Oberflaeche.
create table if not exists public.projekteinsaetze (
  id           uuid primary key default gen_random_uuid(),
  firma_id     uuid not null references public.firmen(id) on delete cascade,
  projekt_id   uuid references public.projekte(id) on delete set null,
  bemerkung    text,
  erstellt_von uuid references auth.users(id) on delete set null,
  erstellt_am  timestamptz not null default now()
);

create index if not exists firmen_aktiv_idx on public.firmen (name) where geloescht_am is null;
create index if not exists firmen_bkp_idx on public.firmen using gin (bkp_codes);
create index if not exists ansprech_firma_idx on public.ansprechpersonen (firma_id, name);
create index if not exists notizen_firma_idx on public.notizen (firma_id, erstellt_am desc);
create index if not exists einsaetze_firma_idx on public.projekteinsaetze (firma_id);

drop trigger if exists bkp_loeschspur on public.bkp_liste;
create trigger bkp_loeschspur before update on public.bkp_liste
  for each row execute function public.setze_loeschspur();
drop trigger if exists firmen_loeschspur on public.firmen;
create trigger firmen_loeschspur before update on public.firmen
  for each row execute function public.setze_loeschspur();

alter table public.bkp_liste        enable row level security;
alter table public.firmen           enable row level security;
alter table public.ansprechpersonen enable row level security;
alter table public.notizen          enable row level security;
alter table public.projekteinsaetze enable row level security;

-- bkp_liste und firmen: kein delete, sie haben einen Papierkorb.
create policy bkp_select on public.bkp_liste for select to authenticated using (true);
create policy bkp_insert on public.bkp_liste for insert to authenticated with check (auth.uid() is not null);
create policy bkp_update on public.bkp_liste for update to authenticated using (true) with check (true);

create policy firmen_select on public.firmen for select to authenticated using (true);
create policy firmen_insert on public.firmen for insert to authenticated with check (auth.uid() is not null);
create policy firmen_update on public.firmen for update to authenticated using (true) with check (true);

-- Ansprechpersonen und Notizen duerfen wirklich geloescht werden.
create policy ansprech_select on public.ansprechpersonen for select to authenticated using (true);
create policy ansprech_insert on public.ansprechpersonen for insert to authenticated with check (auth.uid() is not null);
create policy ansprech_update on public.ansprechpersonen for update to authenticated using (true) with check (true);
create policy ansprech_delete on public.ansprechpersonen for delete to authenticated using (true);

create policy notizen_select on public.notizen for select to authenticated using (true);
create policy notizen_insert on public.notizen for insert to authenticated with check (autor_id = auth.uid());
create policy notizen_update on public.notizen for update to authenticated using (true) with check (true);
create policy notizen_delete on public.notizen for delete to authenticated using (true);

create policy einsaetze_select on public.projekteinsaetze for select to authenticated using (true);
create policy einsaetze_insert on public.projekteinsaetze for insert to authenticated with check (auth.uid() is not null);
create policy einsaetze_update on public.projekteinsaetze for update to authenticated using (true) with check (true);
create policy einsaetze_delete on public.projekteinsaetze for delete to authenticated using (true);

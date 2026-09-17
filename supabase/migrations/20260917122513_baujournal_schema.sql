-- Baujournal TRIGA Baumanagement AG
-- Drei Tabellen plus eine kleine profile-Tabelle fuer die Anzeigenamen,
-- weil auth.users vom Client aus nicht lesbar ist.

create extension if not exists pgcrypto;

-- Anzeigename je Konto. Wird beim Anlegen eines Kontos automatisch
-- befuellt, aus user_metadata.name oder sonst aus dem E-Mail-Lokalteil.
create table if not exists public.profile (
  id    uuid primary key references auth.users(id) on delete cascade,
  name  text not null,
  erstellt_am timestamptz not null default now()
);

create table if not exists public.projekte (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  standort              text,
  bauherrschaft         text,
  parzelle              text,
  projekt_nr            text,
  notizen               text,
  zusatz_kontrollpunkte jsonb not null default '[]'::jsonb,
  archiviert            boolean not null default false,
  erstellt_von          uuid references auth.users(id) on delete set null,
  erstellt_am           timestamptz not null default now()
);

create table if not exists public.eintraege (
  id            uuid primary key default gen_random_uuid(),
  projekt_id    uuid not null references public.projekte(id) on delete cascade,
  datum         date not null default current_date,
  ersteller_id  uuid references auth.users(id) on delete set null,
  wetter        text,
  temperatur    text,
  -- {"punkte":[{"label":"...","ok":true,"projektspezifisch":false}, ...]}
  -- Die Checkliste wird pro Eintrag mitgeschrieben, damit ein spaeter
  -- geaenderter Projekt-Kontrollpunkt alte Eintraege nicht verfaelscht.
  kontrolle     jsonb not null default '{"punkte":[]}'::jsonb,
  firmen        text,
  fortschritt   text,
  feststellungen text,
  anweisungen   text,
  fotos_hinweis boolean not null default false,
  erstellt_am   timestamptz not null default now()
);

-- Beweissicherung: jede nachtraegliche Korrektur wird zusaetzlich
-- protokolliert, das Original bleibt im Eintrag sichtbar.
create table if not exists public.eintraege_korrekturen (
  id            uuid primary key default gen_random_uuid(),
  eintrag_id    uuid not null references public.eintraege(id) on delete cascade,
  geaendert_von uuid references auth.users(id) on delete set null,
  geaendert_am  timestamptz not null default now(),
  feld          text not null,
  alter_wert    text,
  neuer_wert    text
);

create index if not exists eintraege_projekt_datum_idx
  on public.eintraege (projekt_id, datum desc, erstellt_am desc);
create index if not exists korrekturen_eintrag_idx
  on public.eintraege_korrekturen (eintrag_id, geaendert_am desc);
create index if not exists projekte_aktiv_idx
  on public.projekte (archiviert, name);

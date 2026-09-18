-- Schritt 9: aus dem Baujournal-Projekt wird ein uebergreifender Bereich.
--
-- Die Tabelle projekte wird erweitert, nicht ersetzt. Kontrollpunkte,
-- Gebaeude und alle Eintraege bleiben unangetastet, es kommen nur
-- Spalten dazu.

-- bauherrschaft und standort gibt es schon, siehe baujournal_schema.
alter table public.projekte add column if not exists adresse  text;
alter table public.projekte add column if not exists beschrieb text;
alter table public.projekte add column if not exists status   text not null default 'laufend'
  check (status in ('planung', 'laufend', 'abgeschlossen'));

comment on column public.projekte.adresse is
  'Strasse und Ort der Baustelle. standort bleibt daneben bestehen, das Baujournal zeigt es in seiner Kopfzeile.';
comment on column public.projekte.status is
  'planung, laufend oder abgeschlossen. Archivieren ist etwas anderes und steckt weiterhin in archiviert.';

-- Die Unternehmerliste. projekteinsaetze gibt es seit dem Firmenpool als
-- unterstuetzende Tabelle ohne Oberflaeche, genau dafuer war sie gedacht.
alter table public.projekteinsaetze add column if not exists gewerk text;
alter table public.projekteinsaetze add column if not exists status text not null default 'angefragt';
alter table public.projekteinsaetze add column if not exists auftragssumme numeric(12, 2);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'einsatz_status_gueltig') then
    alter table public.projekteinsaetze add constraint einsatz_status_gueltig
      check (status in ('angefragt', 'offeriert', 'beauftragt', 'ausgefuehrt'));
  end if;
end $$;

comment on column public.projekteinsaetze.gewerk is
  'Ein BKP-Code, passend zu bkp_liste.code. Kommt aus der Firma, ist aber frei aenderbar: eine Firma kann auf einem Projekt ausserhalb ihrer ueblichen Kategorie arbeiten.';

-- Wer ist auf diesem Projekt zustaendig. Keine Verbindung zu den
-- Login-Konten, das ist der Bereich Mitarbeiter, siehe dortige Migration.
create table if not exists public.projekt_mitarbeiter (
  id             uuid primary key default gen_random_uuid(),
  projekt_id     uuid not null references public.projekte(id) on delete cascade,
  mitarbeiter_id uuid not null references public.mitarbeiter(id) on delete cascade,
  rolle          text,
  erstellt_von   uuid references auth.users(id) on delete set null,
  erstellt_am    timestamptz not null default now()
);
create unique index if not exists projekt_mitarbeiter_eindeutig
  on public.projekt_mitarbeiter (projekt_id, mitarbeiter_id);

-- Ordner duerfen zu einem Projekt gehoeren, muessen aber nicht. Ohne
-- Zuordnung bleiben sie allgemein sichtbar wie bisher. Dateien erben die
-- Zuordnung ueber ihren Ordner, sie tragen bewusst kein eigenes Feld.
alter table public.ordner add column if not exists projekt_id uuid
  references public.projekte(id) on delete set null;

-- Dasselbe fuer Notizen: ohne Projekt gilt die Notiz allgemein fuer die
-- Firma, mit Projekt haelt sie etwas Projektbezogenes fest.
alter table public.notizen add column if not exists projekt_id uuid
  references public.projekte(id) on delete set null;

create index if not exists einsaetze_projekt_idx on public.projekteinsaetze (projekt_id);
create index if not exists projekt_mitarbeiter_projekt_idx on public.projekt_mitarbeiter (projekt_id);
create index if not exists projekt_mitarbeiter_person_idx on public.projekt_mitarbeiter (mitarbeiter_id);
create index if not exists ordner_projekt_idx on public.ordner (projekt_id) where geloescht_am is null;
create index if not exists notizen_projekt_idx on public.notizen (projekt_id);
create index if not exists projekte_status_idx on public.projekte (status) where not archiviert;

-- Zuordnungen sind trivial wiederherstellbar, hier gibt es bewusst
-- keinen Papierkorb. Dasselbe Muster wie bei Ansprechpersonen und
-- Notizen im Firmenpool.
alter table public.projekt_mitarbeiter enable row level security;
create policy pm_select on public.projekt_mitarbeiter for select to authenticated using (true);
create policy pm_insert on public.projekt_mitarbeiter for insert to authenticated with check (auth.uid() is not null);
create policy pm_update on public.projekt_mitarbeiter for update to authenticated using (true) with check (true);
create policy pm_delete on public.projekt_mitarbeiter for delete to authenticated using (true);

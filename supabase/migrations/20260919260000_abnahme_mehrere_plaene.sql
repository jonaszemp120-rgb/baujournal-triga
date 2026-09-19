-- Mehrere Pläne je Bauabnahme, und die Nadel gehört an einen davon.
--
-- Bisher trug eine Abnahme genau einen Plan: plan_datei_id, plan_seite und
-- plan_bild_pfad standen als Spalten an der Zeile. Für ein Reihenhaus
-- reicht das; bei fünf Häusern mit mehreren Geschossen nicht. Wer alles
-- abnehmen wollte, musste pro Grundriss eine eigene Abnahme aufmachen —
-- und hatte am Schluss fünfzehn Protokolle statt einem.
--
-- Die Pläne bekommen deshalb eine eigene Tabelle, und jeder Mangel zeigt
-- auf genau den Plan, auf dem seine Nadel steckt.
--
-- Das beantwortet zugleich die Frage nach der Positionstreue. x und y
-- standen schon bisher als Anteil zwischen 0 und 1 und bezogen sich auf
-- das einmal gerenderte PNG, nicht auf die Quelldatei — ein Austausch des
-- PDF in den Dokumenten verschob also nie eine Nadel. Neu steht das auch
-- im Datenmodell: plan_id ist Pflicht, und welcher Plan gemeint ist, sagt
-- nicht mehr die Abnahme, sondern der Mangel selbst.

create table if not exists public.abnahme_plaene (
  id           uuid primary key default gen_random_uuid(),
  abnahme_id   uuid not null references public.abnahmen(id) on delete cascade,

  -- Wofür der Plan steht: "Haus Magnolia, 1. OG".
  titel        text not null check (length(btrim(titel)) between 1 and 120),

  -- Woher er kam. Nur zur Herkunft; massgebend ist das gerenderte Bild.
  datei_id     uuid references public.dateien(id) on delete set null,
  seite        smallint not null default 1 check (seite >= 1),

  /* Die einmal gerenderte Fassung im Bucket abnahme. Sie ist die
     Bezugsfläche jeder Nadel und ändert sich nie — wird in den Dokumenten
     ein neues PDF hochgeladen, bleibt dieses Bild, wie es ist. */
  bild_pfad    text not null,

  reihenfolge  smallint not null default 0,
  erstellt_von uuid not null references auth.users(id) on delete cascade,
  erstellt_am  timestamptz not null default now(),

  -- Gegenstück zum zusammengesetzten Fremdschlüssel unten.
  unique (id, abnahme_id)
);

create index if not exists abnahme_plaene_abnahme_idx
  on public.abnahme_plaene (abnahme_id, reihenfolge, erstellt_am);

/* Den Bestand übernehmen: jede Abnahme mit gerendertem Plan bekommt ihren
   einen Plan als Zeile, und ihre Mängel zeigen darauf. Die Nadeln bleiben
   dabei exakt, wo sie waren — es ist dasselbe Bild. */
insert into public.abnahme_plaene (abnahme_id, titel, datei_id, seite, bild_pfad, reihenfolge, erstellt_von, erstellt_am)
select a.id, a.titel, a.plan_datei_id, a.plan_seite, a.plan_bild_pfad, 0, a.erstellt_von, a.erstellt_am
  from public.abnahmen a
 where a.plan_bild_pfad is not null
   and not exists (select 1 from public.abnahme_plaene p where p.abnahme_id = a.id);

alter table public.maengel add column if not exists plan_id uuid;

update public.maengel m
   set plan_id = p.id
  from public.abnahme_plaene p
 where p.abnahme_id = m.abnahme_id and m.plan_id is null;

/* Ein Mangel ohne Plan ergibt keinen Sinn: die Nadel braucht eine Fläche,
   auf der sie steckt. Und der Plan muss zur selben Abnahme gehören —
   deshalb der zusammengesetzte Fremdschlüssel und nicht nur plan_id. */
alter table public.maengel alter column plan_id set not null;

alter table public.maengel drop constraint if exists maengel_plan_passt;
alter table public.maengel add constraint maengel_plan_passt
  foreign key (plan_id, abnahme_id)
  references public.abnahme_plaene (id, abnahme_id) on delete cascade;

create index if not exists maengel_plan_idx on public.maengel (plan_id, nummer);

/* Die alten Spalten fallen weg. Zwei Orte für denselben Plan wären zwei
   Orte, an denen etwas auseinanderlaufen kann. */
alter table public.abnahmen drop column if exists plan_datei_id;
alter table public.abnahmen drop column if exists plan_seite;
alter table public.abnahmen drop column if exists plan_bild_pfad;

/* --- Regeln --------------------------------------------------------------- */

alter table public.abnahme_plaene enable row level security;

create policy abnahme_plaene_select on public.abnahme_plaene for select to authenticated
  using (public.ist_triga_person(auth.uid()));
create policy abnahme_plaene_insert on public.abnahme_plaene for insert to authenticated
  with check (erstellt_von = auth.uid() and public.ist_triga_person(auth.uid()));
create policy abnahme_plaene_update on public.abnahme_plaene for update to authenticated
  using (public.ist_triga_person(auth.uid()))
  with check (public.ist_triga_person(auth.uid()));
create policy abnahme_plaene_delete on public.abnahme_plaene for delete to authenticated
  using (public.ist_triga_person(auth.uid()));

/* Nach dem Abschluss ist auch an den Plänen Schluss. abnahme_gesperrt()
   liest die Kennung der Abnahme aus abnahme_id — die Spalte heisst hier
   gleich wie bei den Mängeln, die Funktion passt unverändert. */
drop trigger if exists plaene_gesperrt_trigger on public.abnahme_plaene;
create trigger plaene_gesperrt_trigger
  before insert or update or delete on public.abnahme_plaene
  for each row execute function public.abnahme_gesperrt();

/* Einen Plan mit Nadeln darauf entfernt niemand aus Versehen: die Mängel
   gingen mit ihm, und niemand merkte es. Steht die Abnahme selbst nicht
   mehr da, greift die Regel nicht — dann räumt der Fremdschlüssel ab, und
   dabei soll nichts dazwischenfunken. */
create or replace function public.plan_nur_ohne_maengel()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  daran integer;
begin
  if exists (select 1 from public.abnahmen where id = old.abnahme_id) then
    select count(*) into daran from public.maengel where plan_id = old.id;
    if daran > 0 then
      raise exception 'Auf diesem Plan stecken % Maengel. Erst die Nadeln entfernen, dann den Plan.', daran
        using errcode = '42501';
    end if;
  end if;
  return old;
end $$;

drop trigger if exists plan_nur_ohne_maengel on public.abnahme_plaene;
create trigger plan_nur_ohne_maengel
  before delete on public.abnahme_plaene
  for each row execute function public.plan_nur_ohne_maengel();

comment on table public.abnahme_plaene is
  'Die Grundrisse einer Bauabnahme, einer je Haus und Geschoss. bild_pfad zeigt auf die einmal gerenderte Fassung im Bucket abnahme und aendert sich nie: x und y eines Mangels sind Anteile dieses Bildes.';

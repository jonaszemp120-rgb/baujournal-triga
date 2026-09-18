-- Mehrere Fotos an einem Feed-Beitrag.
--
-- Bisher hing genau ein Foto am Beitrag, als Spalte bild_pfad. Von einem
-- Rundgang bringt aber niemand ein Foto mit, sondern fünf. Die Fotos
-- bekommen deshalb eine eigene Tabelle — eine Spalte pro Foto wäre eine
-- Grenze, die man einmal festlegt und danach bereut.
--
-- Der Bestand wandert mit: jeder Beitrag, der bisher ein Foto trug, hat
-- danach genau eine Zeile in feed_bilder und sieht in der App aus wie
-- vorher. Die alte Spalte fällt weg, damit es nicht zwei Orte gibt, an
-- denen dasselbe stehen könnte.

create table if not exists public.feed_bilder (
  id           uuid primary key default gen_random_uuid(),
  beitrag_id   uuid not null references public.feed_beitraege(id) on delete cascade,

  /* Genau wie bisher: der Pfad zeigt in den Bucket feed-bilder und wird
     beim Ablauf geleert, die Zeile bleibt stehen. Daran erkennt die App
     den Unterschied zwischen "war nie ein Foto" und "Foto ist weg".

     Die Frist steht an der Datei und nicht nur am Beitrag. Gelöscht wird
     eine Datei, und wer 30 Tage zählt, zählt sie ab dem Hochladen —
     dieselben Spaltennamen wie in nachrichten und feed_beitraege, damit
     api/_bilder.js unverändert auch hier aufräumen kann. */
  bild_pfad    text,
  bild_ablauf  timestamptz not null,

  reihenfolge  smallint not null default 0,
  erstellt_am  timestamptz not null default now()
);

create index if not exists feed_bilder_beitrag_idx
  on public.feed_bilder (beitrag_id, reihenfolge, erstellt_am);
create index if not exists feed_bilder_ablauf_idx
  on public.feed_bilder (bild_ablauf) where bild_pfad is not null;

/* Den Bestand übernehmen, bevor die alte Spalte verschwindet. Beiträge
   ohne Foto tragen kein bild_ablauf und bleiben unberührt; bei einem
   Beitrag, dessen Foto schon abgelaufen ist, wandert die leere Stelle mit
   und die App sagt weiterhin, dass es das Foto einmal gab. */
insert into public.feed_bilder (beitrag_id, bild_pfad, bild_ablauf, reihenfolge)
select id, bild_pfad, bild_ablauf, 0
  from public.feed_beitraege
 where bild_ablauf is not null
   and not exists (select 1 from public.feed_bilder x where x.beitrag_id = feed_beitraege.id);

drop index if exists public.feed_beitraege_ablauf_idx;
alter table public.feed_beitraege drop column if exists bild_pfad;

comment on column public.feed_beitraege.bild_ablauf is
  'Steht, sobald der Beitrag Fotos trägt, und sagt, wann sie ablaufen. Die Fotos selbst stehen in feed_bilder. Die Spalte bleibt, weil die Prüfregel am Beitrag daran haengt: ein Beitrag braucht Text oder Fotos.';

/* --- Regeln --------------------------------------------------------------- */

alter table public.feed_bilder enable row level security;

/* Dieselben Regeln wie für die Dateien im Bucket: sehen darf das ganze
   Haus, anlegen und entfernen darf, wer den Beitrag schreiben oder
   löschen darf. feed_darf_bild() gibt es dafür schon. */
create policy feed_bilder_select on public.feed_bilder for select to authenticated
  using (public.ist_triga_person(auth.uid()));
create policy feed_bilder_insert on public.feed_bilder for insert to authenticated
  with check (public.feed_darf_bild(beitrag_id));
create policy feed_bilder_update on public.feed_bilder for update to authenticated
  using (public.feed_darf_bild(beitrag_id))
  with check (public.feed_darf_bild(beitrag_id));
create policy feed_bilder_delete on public.feed_bilder for delete to authenticated
  using (public.feed_darf_bild(beitrag_id));

/* --- Echtzeit -------------------------------------------------------------- */

/* Aus demselben Grund wie bei feed_optionen: der Beitrag wird zuerst
   geschrieben, seine Fotos zeigen auf ihn und folgen danach. Wer auf die
   Meldung des Beitrags hin nachfragt, fragt zu früh und bekommt nichts.
   Also kommen die Fotos als eigene Zeilen herein. */
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public' and tablename = 'feed_bilder'
  ) then
    alter publication supabase_realtime add table public.feed_bilder;
  end if;
end $$;

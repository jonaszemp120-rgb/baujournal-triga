-- Vier Ergänzungen für Mitarbeiter, Firmenpool und Dokumente.
-- Sie stehen nebeneinander und berühren einander nicht.

/* --- A2: Wer heute nicht da ist ------------------------------------------- */

/* Das Problem an dieser Stelle ist nicht der Hinweis, sondern die Frage,
   wer ihn sehen darf. Ein Ferienantrag gehört der antragstellenden
   Person und der Geschäftsleitung — `antraege_select` sagt genau das.
   Wer im Adressbuch blättert, soll aber sehen, dass jemand bis Freitag
   weg ist, ohne damit die Anträge des ganzen Teams lesen zu können.

   Deshalb eine Funktion und keine weichere Policy: sie gibt genau zwei
   Angaben heraus — wer und bis wann. Nicht der Betrag, nicht die
   Bemerkung, nicht wer entschieden hat, und auch nicht, dass es
   überhaupt einen Antrag gibt, sobald er vorbei ist. Ein abgelehnter
   oder noch offener Antrag steht nie darin: erst ein genehmigter macht
   jemanden abwesend. */
create or replace function public.abwesend_heute()
returns table (user_id uuid, bis date)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select a.erstellt_von, max(a.bis)
    from public.antraege a
   where a.art = 'ferien'
     and a.status = 'genehmigt'
     and a.von <= current_date
     and a.bis >= current_date
     and public.ist_triga_person(auth.uid())
   group by a.erstellt_von;
$function$;

comment on function public.abwesend_heute() is
  'Wer heute in genehmigten Ferien ist, und bis wann. Gibt nur diese zwei Angaben heraus - den Antrag selbst sieht weiterhin nur die antragstellende Person und die Geschaeftsleitung.';

revoke all on function public.abwesend_heute() from public, anon;
grant execute on function public.abwesend_heute() to authenticated;

/* Ueberlappende Ferien einer Person ergaeben sonst zwei Zeilen; max(bis)
   nimmt die laengere. Die Suche nach dem heutigen Tag laeuft ueber
   diesen Index. */
create index if not exists antraege_ferien_zeitraum
  on public.antraege(art, status, von, bis) where art = 'ferien';

/* --- B: Frist an einer roten Notiz ---------------------------------------- */

alter table public.notizen
  add column if not exists frist date,
  add column if not exists frist_gemeldet_am timestamptz;

comment on column public.notizen.frist is
  'Optionales Datum, bis wann etwas erledigt sein muss. Nur bei roten Notizen - eine gruene Notiz hat nichts, was ablaeuft.';

comment on column public.notizen.frist_gemeldet_am is
  'Wann die Erinnerung hinausging. Damit meldet sich dieselbe Frist nicht jeden Tag neu; gesetzt wird es von api/fristen.js.';

/* Eine Frist ohne Rot waere eine Mahnung ohne Anlass: die Farbe sagt,
   dass etwas im Argen liegt, und nur dann gibt es etwas zu befristen. */
alter table public.notizen drop constraint if exists notizen_frist_nur_bei_rot;
alter table public.notizen add constraint notizen_frist_nur_bei_rot check (
  frist is null or farbe = 'rot'
);

/* Die Frist gehoert der Notiz und damit der Person, die sie geschrieben
   hat. Wer die Notiz aendern darf, aendert auch ihre Frist - dafuer ist
   nichts Neues zu oeffnen. frist_gemeldet_am dagegen setzt allein die
   Cron-Funktion mit dem Dienstschluessel; von der App aus soll niemand
   eine Erinnerung als erledigt markieren koennen, die nie hinausging. */

/* Der taegliche Lauf sucht genau eine Menge: rote Notizen, deren Frist
   in drei Tagen faellig wird und zu denen noch nichts gemeldet wurde. */
create index if not exists notizen_offene_fristen
  on public.notizen(frist) where frist is not null and frist_gemeldet_am is null;

/* --- C1: Der Text in den PDF ---------------------------------------------- */

/* Eine Suche, die nur Dateinamen kennt, findet "Offerte_2026_final.pdf"
   und nicht die Firma, um die es darin geht. Also wird der Text einmal
   herausgezogen und steht danach neben der Datei.

   Herausgezogen wird er im Browser mit pdf.js, das ohnehin schon unter
   vendor/ liegt: beim Hochladen, und bei aelteren Dateien beim ersten
   Oeffnen. Serverseitig ginge es auch, braeuchte aber eine Bibliothek in
   einer package.json - und damit den Build-Schritt, den dieses Projekt
   bewusst nicht hat.

   volltext_am sagt, wann das geschah. Damit laesst sich unterscheiden,
   was noch nie durchsucht wurde von dem, worin wirklich kein Text steht
   - ein eingescanntes Blatt Papier zum Beispiel. */
alter table public.dateien
  add column if not exists volltext text,
  add column if not exists volltext_am timestamptz;

comment on column public.dateien.volltext is
  'Der Text aus dem PDF, im Browser mit pdf.js herausgezogen. Leer heisst: kein Text darin, etwa bei einem Scan. Null heisst: noch nicht angesehen.';

comment on column public.dateien.volltext_am is
  'Wann der Text herausgezogen wurde. Unterscheidet "nichts drin" von "noch nie nachgesehen".';

/* Fuer die Suche. GIN mit trigram, weil die Leute nach Wortteilen suchen
   ("Fankhaus") und nicht nach ganzen Woertern - eine Volltextsuche mit
   Wortstamm faende das nicht. */
create extension if not exists pg_trgm;
create index if not exists dateien_volltext_suche
  on public.dateien using gin (volltext gin_trgm_ops);

/* --- C2: Zuletzt angesehen ------------------------------------------------- */

/* Eine Zeile je Person und Datei, nicht eine Liste je Person. So bleibt
   "zuletzt angesehen" beim zweiten Oeffnen derselben Datei ein Eintrag
   und nicht zwei, und das Aufraeumen ist ein simples order by.

   In der Datenbank und nicht im Browser: wer am Handy eine Offerte
   angesehen hat, findet sie am Nachmittag am Schreibtisch wieder. Im
   localStorage bliebe sie auf dem einen Geraet. */
create table if not exists public.datei_zugriffe (
  user_id     uuid not null references auth.users(id) on delete cascade,
  datei_id    uuid not null references public.dateien(id) on delete cascade,
  zuletzt_am  timestamptz not null default now(),
  primary key (user_id, datei_id)
);

create index if not exists datei_zugriffe_zeit
  on public.datei_zugriffe(user_id, zuletzt_am desc);

comment on table public.datei_zugriffe is
  'Wer welche Datei wann zuletzt geoeffnet hat. Grundlage fuer "Zuletzt angesehen" - eine Zeile je Person und Datei, damit dieselbe Datei nicht mehrfach in der Liste steht.';

alter table public.datei_zugriffe enable row level security;

/* Jede Person sieht und pflegt nur ihre eigene Spur. Auch die
   Geschaeftsleitung nicht: wer wann welche Datei geoeffnet hat, ist eine
   Frage der Bequemlichkeit und keine Aufsicht. */
drop policy if exists zugriffe_select on public.datei_zugriffe;
create policy zugriffe_select on public.datei_zugriffe
  for select to authenticated using (user_id = auth.uid());

drop policy if exists zugriffe_insert on public.datei_zugriffe;
create policy zugriffe_insert on public.datei_zugriffe
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists zugriffe_update on public.datei_zugriffe;
create policy zugriffe_update on public.datei_zugriffe
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists zugriffe_delete on public.datei_zugriffe;
create policy zugriffe_delete on public.datei_zugriffe
  for delete to authenticated using (user_id = auth.uid());

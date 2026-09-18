-- Ein eigener Text auf dem Abzeichen.
--
-- Die Berechtigungsstufe und der Text auf dem Abzeichen waren bisher
-- dasselbe. Meistens stimmt das auch. Bei der Administration nicht: sie
-- braucht dieselben Rechte wie die Geschäftsleitung, gehört ihr aber
-- nicht an — und ein Abzeichen "Geschäftsleitung" neben der Funktion
-- "Administration" behauptet etwas Falsches über die Person.
--
-- Eine vierte Stufe wäre der falsche Weg: sie müsste überall mitgepflegt
-- werden, wo über Rechte entschieden wird, und zwei Stufen mit exakt
-- denselben Rechten driften früher oder später auseinander. Deshalb hier
-- nur ein Anzeigetext. Er ändert nichts, gar nichts: wer was darf, hängt
-- allein an berechtigung.

alter table public.mitarbeiter
  add column if not exists badge_label text;

alter table public.mitarbeiter drop constraint if exists mitarbeiter_badge_label_check;
alter table public.mitarbeiter add constraint mitarbeiter_badge_label_check
  check (badge_label is null or (length(btrim(badge_label)) between 1 and 24));

comment on column public.mitarbeiter.badge_label is
  'Optionaler Text auf dem Abzeichen. Leer heisst: der Name der Berechtigungsstufe. Reine Anzeige, ohne jede Wirkung auf Rechte.';

/* Pflegen darf das, wer auch die Stufe vergibt. Dafür braucht es keine
   neue Regel: der Trigger mitarbeiter_schutz() führt eine Liste dessen,
   was man an der eigenen Zeile ändern darf, und dort steht badge_label
   nicht drin. Eine neue Spalte ist damit von sich aus geschützt — genau
   deshalb ist die Liste eine Liste des Erlaubten und nicht des
   Verbotenen. */

-- Silvia Weber: Administration mit erweiterten Rechten.
update public.mitarbeiter
   set badge_label = 'Erweiterte Rechte'
 where email = 'silvia.weber@triga.ch'
   and geloescht_am is null;

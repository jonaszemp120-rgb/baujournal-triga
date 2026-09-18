-- Die Berechtigungsstufe bekommt eine dritte Stufe und die unterste einen
-- neuen Namen.
--
-- "mitarbeitend" heisst neu "mitarbeiter". Der Wert steht in der Datenbank
-- und nicht nur im Bildschirmtext, also wird er hier mitgezogen — sonst
-- stünde der alte Name weiter in der Tabelle und nur die App zeigte den
-- neuen an.
--
-- "entwickler" ist die dritte Stufe. Sie steht der Geschäftsleitung in den
-- Rechten gleich; entschieden wird das in der App an genau einer Stelle
-- (istBerechtigt in js/app.js), nicht hier.

alter table public.mitarbeiter
  drop constraint if exists mitarbeiter_berechtigung_check;

alter table public.mitarbeiter
  alter column berechtigung drop default;

update public.mitarbeiter
  set berechtigung = 'mitarbeiter'
  where berechtigung = 'mitarbeitend';

alter table public.mitarbeiter
  alter column berechtigung set default 'mitarbeiter';

alter table public.mitarbeiter
  add constraint mitarbeiter_berechtigung_check
  check (berechtigung in ('mitarbeiter', 'geschaeftsleitung', 'entwickler'));

comment on column public.mitarbeiter.berechtigung is
  'Berechtigungsstufe: mitarbeiter, geschaeftsleitung oder entwickler. Nicht zu verwechseln mit rolle, das ist die Funktion im Betrieb. Entwickler darf dasselbe wie die Geschaeftsleitung.';

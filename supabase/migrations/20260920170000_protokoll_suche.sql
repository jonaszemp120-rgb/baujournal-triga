-- Suche über alle Sitzungsprotokolle eines Projekts.
--
-- Keine neue Spalte und keine neue Tabelle: alles, was gesucht wird,
-- steht schon da. Der Traktandentext in protokoll_traktanden, der
-- Firmenname in protokoll_teilnehmer.firma - jener Schnappschuss, den
-- das Protokoll vom Tag der Sitzung festhält. Gesucht wird also in dem,
-- was damals galt, und nicht in der heutigen Unternehmerliste; genau so
-- soll ein Protokoll gelesen werden.
--
-- Was fehlt, sind die Indexe. Ohne sie liest Postgres bei jeder Eingabe
-- alle Traktanden aller Projekte durch. Bei zwölf Sitzungen merkt das
-- niemand, bei dreihundert schon.

create extension if not exists pg_trgm;

/* GIN mit trigram und nicht die Volltextsuche mit Wortstamm: gesucht wird
   nach Wortteilen. Wer "Fankhaus" eintippt, will die Fankhauser AG
   finden, und tsvector fände das nicht. Dieselbe Überlegung wie beim
   Volltext der PDF. */
create index if not exists traktanden_titel_suche
  on public.protokoll_traktanden using gin (titel gin_trgm_ops);

create index if not exists traktanden_text_suche
  on public.protokoll_traktanden using gin (text gin_trgm_ops);

create index if not exists teilnehmer_firma_suche
  on public.protokoll_teilnehmer using gin (firma gin_trgm_ops);

comment on index public.teilnehmer_firma_suche is
  'Fuer die Suche ueber die Protokolle eines Projekts nach erwaehnten Firmennamen.';

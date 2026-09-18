-- Der Feed in Echtzeit.
--
-- Wie im Chat: was jemand postet, kommentiert oder mit einem Herz versieht,
-- soll bei den anderen erscheinen, ohne dass jemand neu lädt.
--
-- Vier Tabellen kommen in die Veröffentlichung, eine bewusst nicht:
--
--   feed_beitraege   neue Beiträge und Umfragen, und ihr Verschwinden
--   feed_optionen    die Antwortmöglichkeiten einer neuen Umfrage
--   feed_kommentare  neue und gelöschte Kommentare
--   feed_reaktionen  gesetzte und entfernte Herzen
--
-- feed_stimmen bleibt draussen, und zwar aus demselben Grund, aus dem es
-- die Tabelle überhaupt gibt: bei einer anonymen Umfrage gibt die Policy
-- fremde Stimmzeilen nicht heraus. Die Echtzeit hält sich an dieselbe
-- Policy — eine Stimme käme also bei niemandem an ausser bei der Person,
-- die sie abgegeben hat, und das Ergebnis stünde bei allen anderen still.
-- Die App meldet eine neue Stimme deshalb als Rundruf über den Kanal
-- ("stimme", mit der Kennung der Umfrage), und jeder holt sich daraufhin
-- das Ergebnis mit feed_ergebnisse(). Verraten wird damit nichts, was die
-- Balken nicht ohnehin zeigen: dass eine Stimme dazugekommen ist. Wer sie
-- abgegeben hat, verlässt die Datenbank weiterhin nie.
--
-- feed_optionen muss dabei sein und lässt sich nicht durch eine Abfrage
-- ersetzen: die Umfrage wird zuerst geschrieben, ihre Antwortmöglichkeiten
-- zeigen auf sie und folgen danach. Wer auf die Meldung der Umfrage hin
-- nachfragt, fragt zu früh und bekommt nichts. Also kommen sie als eigene
-- Zeilen herein, und die Karte sagt so lange, dass geladen wird.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public' and tablename = 'feed_beitraege'
  ) then
    alter publication supabase_realtime add table public.feed_beitraege;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public' and tablename = 'feed_optionen'
  ) then
    alter publication supabase_realtime add table public.feed_optionen;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public' and tablename = 'feed_kommentare'
  ) then
    alter publication supabase_realtime add table public.feed_kommentare;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public' and tablename = 'feed_reaktionen'
  ) then
    alter publication supabase_realtime add table public.feed_reaktionen;
  end if;
end $$;

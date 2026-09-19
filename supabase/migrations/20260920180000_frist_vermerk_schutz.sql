-- Der Vermerk "Erinnerung ist hinausgegangen" gehoert dem taeglichen Lauf.
--
-- In der Migration zur Frist steht der Satz, dass frist_gemeldet_am allein
-- api/fristen.js setzt. Beim Nachlesen der Policies war das eine Absicht
-- und keine Regel: notizen_update erlaubt jedem im Team jede Aenderung an
-- jeder Notiz, und damit auch diese eine Spalte.
--
-- Das ist keine Sicherheitsluecke - wer die Zeile ohnehin bearbeiten darf,
-- koennte die Frist auch gleich loeschen. Es ist aber ein stiller Weg, eine
-- fremde Erinnerung verschwinden zu lassen, ohne dass sich sichtbar etwas
-- aendert. Und ein Kommentar, der etwas verspricht, was die Datenbank nicht
-- haelt, ist schlimmer als gar keiner.
--
-- Also die Regel nachgereicht. Ein Trigger und keine engere Policy: die
-- Policy muesste den ganzen Zugriff einschraenken, hier geht es um genau
-- eine Spalte. Dasselbe Muster wie antrag_schutz() bei den Antraegen.

create or replace function public.notiz_frist_vermerk()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  -- Der taegliche Lauf kommt mit dem Dienstschluessel und ohne auth.uid().
  if auth.uid() is null then
    return new;
  end if;

  -- Zuruecknehmen bleibt erlaubt: wer die Frist verschiebt, setzt den
  -- Vermerk zurueck, und dann meldet sich auch die neue Frist wieder.
  -- Das macht die App beim Speichern, siehe js/firmenpool.js.
  if new.frist_gemeldet_am is null then
    return new;
  end if;

  -- Unveraendert mitgeschickt ist keine Aenderung.
  if tg_op = 'UPDATE' and new.frist_gemeldet_am is not distinct from old.frist_gemeldet_am then
    return new;
  end if;

  raise exception 'Der Vermerk zur Erinnerung wird nicht von Hand gesetzt.';
end
$function$;

comment on function public.notiz_frist_vermerk() is
  'Haelt notizen.frist_gemeldet_am fuer die App geschlossen. Gesetzt wird der Vermerk allein vom taeglichen Lauf in api/fristen.js, der mit dem Dienstschluessel kommt und deshalb kein auth.uid() hat. Zuruecknehmen auf null bleibt erlaubt - das macht die App, wenn jemand die Frist verschiebt.';

drop trigger if exists notiz_frist_vermerk_trigger on public.notizen;
create trigger notiz_frist_vermerk_trigger
  before insert or update on public.notizen
  for each row execute function public.notiz_frist_vermerk();

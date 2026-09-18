-- Löschen im Chat, und die Grundlage für die Lesebestätigung.
--
-- Zwei verschiedene Arten von Löschen, also zwei verschiedene Wege:
--
--   * Ein ganzes Gespräch verschwindet wirklich. Die Zeile geht weg, alles
--     daran hängende mit ihr. Das darf jedes Mitglied, und es gilt für
--     alle — ein "nur bei mir ausblenden" gäbe es sonst als zweiten
--     Zustand neben dem ersten, und niemand wüsste mehr, was der andere
--     sieht.
--
--   * Eine einzelne Nachricht bleibt als Zeile stehen und verliert ihren
--     Inhalt. Sonst risse sie eine Lücke in den Verlauf, aus der niemand
--     mehr schlau wird. Das darf nur, wer sie geschrieben hat.
--
-- Für die Lesebestätigung braucht es nichts Neues: zuletzt_gelesen steht
-- schon in chat_mitglieder und dient bereits dem Ungelesen-Zähler. Eine
-- Nachricht gilt als gelesen, sobald dieser Zeitpunkt bei allen anderen
-- Mitgliedern nicht vor ihrem Sendezeitpunkt liegt. Keine zweite Tabelle,
-- keine Spalte pro Nachricht, kein zweiter Ort, der abweichen kann.

alter table public.nachrichten
  add column if not exists geloescht_am timestamptz;

comment on column public.nachrichten.geloescht_am is
  'Gesetzt heisst: die schreibende Person hat die Nachricht geloescht. Die Zeile bleibt, damit im Verlauf ein Platzhalter stehen kann statt einer Luecke.';

-- Die Tabelle verlangte bisher, dass jede Nachricht entweder Text oder ein
-- Bild trägt. Richtig beim Erfassen — eine leere Nachricht soll niemand
-- abschicken können. Falsch beim Löschen: dort ist das Leersein gerade der
-- Zweck. Die Bedingung bekommt deshalb den dritten Fall dazu.
alter table public.nachrichten drop constraint if exists nachrichten_check;
alter table public.nachrichten add constraint nachrichten_check
  check (text is not null or bild_ablauf is not null or geloescht_am is not null);

/* --- Ein ganzes Gespräch ---------------------------------------------- */

/* Jedes Mitglied darf. ist_chat_mitglied() gibt es schon und läuft als
   security definer — eine Policy darf eine Tabelle mit RLS nicht direkt
   lesen, das hat uns schon einmal ein Gespräch gekostet. */
drop policy if exists chats_delete on public.chats;
create policy chats_delete on public.chats
  for delete to authenticated
  using (public.ist_chat_mitglied(id));

/* --- Eine einzelne Nachricht ------------------------------------------- */

/* Kein echtes Löschen, sondern genau eine erlaubte Änderung: Inhalt raus,
   Stempel rein. Die Policy entscheidet, wer; der Trigger, was.
   Ohne den Trigger wäre aus dem Löschen ein Bearbeiten geworden, und
   Nachrichten sollen sich ausdrücklich nicht umschreiben lassen. */
drop policy if exists nachrichten_update on public.nachrichten;
create policy nachrichten_update on public.nachrichten
  for update to authenticated
  using (absender = auth.uid())
  with check (absender = auth.uid());

create or replace function public.nachricht_nur_loeschen()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then return new; end if;

  if old.geloescht_am is not null then
    raise exception 'Diese Nachricht ist bereits geloescht.' using errcode = '42501';
  end if;
  if new.geloescht_am is null then
    raise exception 'Nachrichten lassen sich nur loeschen, nicht aendern.' using errcode = '42501';
  end if;
  if new.text is not null or new.bild_pfad is not null then
    raise exception 'Beim Loeschen muss der Inhalt weg.' using errcode = '42501';
  end if;
  if new.chat_id is distinct from old.chat_id
     or new.absender is distinct from old.absender
     or new.erstellt_am is distinct from old.erstellt_am then
    raise exception 'Nachrichten lassen sich nur loeschen, nicht aendern.' using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.nachricht_nur_loeschen() is
  'Laesst an einer Nachricht genau eine Aenderung zu: Inhalt leeren und geloescht_am setzen.';

drop trigger if exists nachricht_nur_loeschen on public.nachrichten;
create trigger nachricht_nur_loeschen
  before update on public.nachrichten
  for each row execute function public.nachricht_nur_loeschen();

/* --- Die Bilder dazu ---------------------------------------------------- */

/* Wer eine Nachricht mit Bild löscht oder ein ganzes Gespräch, muss die
   Datei auch aus dem Bucket bekommen. Sonst bliebe sie dort liegen, ohne
   dass irgendeine Zeile noch auf sie zeigt — und der tägliche Aufräumlauf
   findet sie nie, der geht über nachrichten. */
drop policy if exists chatbilder_delete on storage.objects;
create policy chatbilder_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'chat-bilder'
         and public.ist_chat_mitglied(((storage.foldername(name))[1])::uuid));

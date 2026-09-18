-- Ein neues Gespräch liess sich nicht anlegen:
-- "new row violates row-level security policy for table chat_mitglieder".
--
-- Die Policy verlangte nicht etwa Mitgliedschaft — sie fragte, ob man das
-- Gespräch selbst erstellt hat:
--
--     exists (select 1 from public.chats c
--              where c.id = chat_id and c.erstellt_von = auth.uid())
--
-- Der Haken liegt eine Ebene tiefer. Diese Unterabfrage läuft als die
-- angemeldete Person und damit selbst durch chats_select, und die verlangt
-- ist_chat_mitglied(id). Im Moment der allerersten Zeile ist aber noch
-- niemand Mitglied. Also sah die Unterabfrage nichts, die Bedingung war
-- falsch, und das Gespräch kam nie zustande.
--
-- Die Lehre: eine Policy darf eine Tabelle mit RLS nicht direkt lesen. Wer
-- das braucht, geht über eine Funktion mit security definer — genau so, wie
-- es ist_chat_mitglied() und ist_berechtigt() schon tun.

/* Wer hat dieses Gespräch angelegt? Liest chats am RLS vorbei, sonst
   entstünde dieselbe Schleife wie zuvor. search_path fest verdrahtet,
   damit niemand der Funktion eine eigene Tabelle unterschiebt. */
create or replace function public.ist_chat_ersteller(p_chat uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.chats
     where id = p_chat and erstellt_von = auth.uid()
  );
$$;

revoke all on function public.ist_chat_ersteller(uuid) from public;
grant execute on function public.ist_chat_ersteller(uuid) to authenticated;

comment on function public.ist_chat_ersteller(uuid) is
  'Wahr, wenn die angemeldete Person dieses Gespraech angelegt hat. security definer, weil eine Policy chats sonst nicht lesen kann.';

/* Mitglieder eintragen darf, wer das Gespräch angelegt hat — beim Anlegen
   selbst und später beim Hinzufügen weiterer Personen. Das deckt beide
   Wege der App ab: den Einzelchat, der beim ersten Öffnen entsteht, und
   die Gruppe, deren Mitglieder die erstellende Person pflegt.

   Sich selbst in ein fremdes Gespräch zu setzen bleibt ausgeschlossen: die
   Bedingung fragt nicht, wer eingetragen wird, sondern wer einträgt. Wer
   ein Gespräch nicht angelegt hat, kommt an keine einzige Zeile heran. */
drop policy if exists mitglieder_insert on public.chat_mitglieder;
create policy mitglieder_insert on public.chat_mitglieder
  for insert to authenticated
  with check (
    public.ist_triga_person(user_id)
    and public.ist_chat_ersteller(chat_id)
  );

/* Dieselbe Unterabfrage stand beim Entfernen. Dort fiel sie nicht auf, weil
   die erstellende Person zu diesem Zeitpunkt längst Mitglied ist und die
   Unterabfrage deshalb durchkam. Trotzdem derselbe Griff: sonst steht hier
   ein Muster, das beim nächsten Mal wieder jemanden kostet. */
drop policy if exists mitglieder_delete on public.chat_mitglieder;
create policy mitglieder_delete on public.chat_mitglieder
  for delete to authenticated
  using (public.ist_chat_ersteller(chat_id));

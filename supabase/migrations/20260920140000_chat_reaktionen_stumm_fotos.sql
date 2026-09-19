-- Chat: Reaktionen, Stummschaltung und das Sichern von Fotos.
--
-- Drei Ergänzungen, die nebeneinander stehen und einander nicht
-- berühren. Keine bestehende Zeile ändert ihre Bedeutung, keine
-- bestehende Regel wird weicher.

/* --- Reaktionen ------------------------------------------------------------ */

/* Eine eigene Tabelle und keine Spalte an der Nachricht. Der Grund ist
   der Zähler: «drei Daumen hoch» ist nicht ein Wert, sondern drei
   Zeilen, und wer davon eine zurücknimmt, soll nicht eine gemeinsame
   Zahl herunterzählen müssen. Genau dort weichen zwei Geräte sonst
   voneinander ab, und niemand merkt es.

   Der Primärschlüssel trägt die ganze Regel: eine Person, eine
   Nachricht, ein Emoji — einmal. Zweimal derselbe Daumen von derselben
   Person ist damit keine Frage der App mehr, sondern unmöglich.
   Verschiedene Emojis derselben Person sind dagegen erlaubt: wer etwas
   gleichzeitig lustig und wichtig findet, darf das sagen. */
create table if not exists public.nachrichten_reaktionen (
  nachricht_id uuid not null references public.nachrichten(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  emoji        text not null,
  erstellt_am  timestamptz not null default now(),
  primary key (nachricht_id, user_id, emoji)
);

/* Die fünf aus dem Entwurf, und keine sechs. Eine freie Auswahl klänge
   grosszügiger, brächte aber eine Nachricht mit vierzig verschiedenen
   Zeichen darunter — unter einer Blase ist kein Platz dafür, und auf
   einem Handy schon gar nicht. */
alter table public.nachrichten_reaktionen
  drop constraint if exists nachrichten_reaktionen_emoji_werte;
alter table public.nachrichten_reaktionen
  add constraint nachrichten_reaktionen_emoji_werte
  check (emoji in ('👍', '❤️', '✅', '😂', '❗'));

create index if not exists nachrichten_reaktionen_nachricht
  on public.nachrichten_reaktionen(nachricht_id);

comment on table public.nachrichten_reaktionen is
  'Eine Zeile je Person, Nachricht und Emoji. Der Zaehler unter der Blase ist die Anzahl Zeilen und keine gepflegte Zahl.';

alter table public.nachrichten_reaktionen enable row level security;

/* Wer im Gespräch sitzt, sieht die Reaktionen darin. Die Policy fragt
   nicht selbst in chat_mitglieder nach, sondern über die bestehende
   security-definer-Funktion — eine Policy, die eine andere geschützte
   Tabelle direkt liest, dreht sich sonst im Kreis. */
create policy reaktionen_select on public.nachrichten_reaktionen
  for select to authenticated
  using (exists (
    select 1 from public.nachrichten n
     where n.id = nachricht_id and public.ist_chat_mitglied(n.chat_id)));

/* Reagieren darf nur, wer im Gespräch ist, und nur in eigenem Namen.
   Ohne die zweite Hälfte könnte jemand einen Daumen im Namen einer
   Kollegin setzen. */
create policy reaktionen_insert on public.nachrichten_reaktionen
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.nachrichten n
       where n.id = nachricht_id and public.ist_chat_mitglied(n.chat_id)));

/* Zurücknehmen nur die eigene. Hier steht ausnahmsweise ein echtes
   delete: eine zurückgenommene Reaktion ist nichts, was jemand später
   noch nachlesen will, und ein Papierkorb für Daumen wäre albern. Der
   Grundsatz, dass Inhalte nicht verschwinden, gilt für Nachrichten und
   Journaleintraege — nicht für ein Zeichen unter einer Blase. */
create policy reaktionen_delete on public.nachrichten_reaktionen
  for delete to authenticated
  using (user_id = auth.uid());

/* Geändert wird eine Reaktion nie: ein anderes Emoji ist eine andere
   Zeile. Deshalb steht hier keine UPDATE-Policy, und das ist Absicht. */

/* Damit die Reaktion bei den anderen erscheint, ohne dass jemand die
   Seite neu lädt. */
alter publication supabase_realtime add table public.nachrichten_reaktionen;

/* --- Stumm und Fotos sichern ------------------------------------------------ */

/* Beides gehört an die Mitgliedszeile und nicht an den Chat: stumm
   stellt jede Person für sich, und ob Fotos gesichert werden, ist eine
   Entscheidung des Geräts seiner Besitzerin. Am Chat stünde es für alle
   gleich, und das wäre falsch. */
alter table public.chat_mitglieder
  add column if not exists stumm boolean not null default false,
  add column if not exists fotos_sichern boolean not null default false;

comment on column public.chat_mitglieder.stumm is
  'Unterdrueckt die Push-Meldungen aus diesem Gespraech. Nachrichten, Ungelesen-Zaehler und Lesestand bleiben unberuehrt - stumm heisst leise, nicht blind. Eine @-Erwaehnung kommt trotzdem durch.';

comment on column public.chat_mitglieder.fotos_sichern is
  'Ob neue Fotos aus diesem Gespraech zum Sichern gesammelt werden. Das Sichern selbst macht der Browser und braucht auf dem iPhone einen Fingertipp - eine Weboberflaeche kommt nicht unbeaufsichtigt an die Fotomediathek.';

/* Der Schutztrigger auf der Mitgliedszeile lässt bisher nur den
   Lesestand und das Admin-Häkchen durch und weist alles andere ab. Die
   beiden neuen Schalter müssen dazu — aber nur an der eigenen Zeile.
   Sonst stellte jemand der Kollegin den Chat stumm.

   Alles übrige bleibt Wort für Wort, wie es war. */
create or replace function public.chat_mitglied_schutz()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if auth.uid() is null then return new; end if;

  if new.chat_id is distinct from old.chat_id
     or new.user_id is distinct from old.user_id
     or new.beigetreten_am is distinct from old.beigetreten_am then
    raise exception 'An einer Mitgliedszeile laesst sich nur der Lesestand, das Admin-Haekchen oder eine eigene Einstellung aendern.'
      using errcode = '42501';
  end if;

  if new.user_id = auth.uid() then
    if new.admin is distinct from old.admin then
      raise exception 'Zum Admin macht einen nur ein anderer Admin.' using errcode = '42501';
    end if;
  else
    if new.zuletzt_gelesen is distinct from old.zuletzt_gelesen then
      raise exception 'Den Lesestand setzt jede Person nur bei sich selbst.' using errcode = '42501';
    end if;
    if new.stumm is distinct from old.stumm
       or new.fotos_sichern is distinct from old.fotos_sichern then
      raise exception 'Stumm und das Sichern von Fotos stellt jede Person nur bei sich selbst.'
        using errcode = '42501';
    end if;
    if not public.ist_chat_admin(new.chat_id) then
      raise exception 'Admins ernennt nur, wer selbst Admin ist.' using errcode = '42501';
    end if;
  end if;

  return new;
end $function$;

/* --- Wer aus einem Gespräch eine Meldung bekommt ---------------------------- */

/* Die Frage, die api/push.js stellt, und die Antwort gehört in die
   Datenbank: dort steht, wer Mitglied ist und wer stumm gestellt hat.
   Eine Funktion, damit die Regel an einer Stelle steht und nicht
   zweimal — in der App und im Server — leicht verschieden.

   Erwähnte Personen stehen nicht darin. Die schneidet api/push.js aus
   dem Text heraus und legt sie dazu: eine Erwähnung kommt auch bei
   stumm gestelltem Gespräch durch, weil sie an eine bestimmte Person
   gerichtet ist und nicht an die Runde. */
create or replace function public.chat_meldeziele(p_chat uuid)
returns setof uuid
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select m.user_id
    from public.chat_mitglieder m
   where m.chat_id = p_chat
     and m.user_id <> auth.uid()
     and not m.stumm
     and public.ist_chat_mitglied(p_chat);
$function$;

comment on function public.chat_meldeziele(uuid) is
  'Die Mitglieder dieses Gespraechs ausser einem selbst, ohne die stumm gestellten. Erwaehnte Personen legt api/push.js selbst dazu - eine Erwaehnung kommt auch durch eine Stummschaltung.';

revoke all on function public.chat_meldeziele(uuid) from public, anon;
grant execute on function public.chat_meldeziele(uuid) to authenticated;

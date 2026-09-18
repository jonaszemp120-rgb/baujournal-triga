-- Schreibschutz auf mitarbeiter.
--
-- Bisher durfte jede angemeldete Person jede Spalte jeder Zeile schreiben.
-- Dass "Mein Profil" nur die eigene Zeile anfasst, war eine Regel der
-- Oberfläche — und eine Regel, die nur in der Oberfläche steht, gilt für
-- niemanden, der direkt gegen die API spricht. Also wandert sie hierher.
--
-- Ab jetzt:
--   * wer mitarbeitend ist, ändert an der eigenen Zeile Telefon, E-Mail und
--     Unterschrift, sonst nichts, und an fremden Zeilen gar nichts
--   * Name, Funktion, Papierkorb und das Anlegen bleiben der Geschäftsleitung
--     und den Entwicklern vorbehalten
--   * die Berechtigungsstufe selbst ändert niemand ohne diese Stufe. Sich
--     selbst hochzustufen ist damit ausgeschlossen: dafür bräuchte es die
--     Stufe, die man sich gerade geben will.
--
-- Zwei Schranken statt einer, weil RLS und Spalten zwei verschiedene Dinge
-- sind: die Policy entscheidet, welche Zeile, der Trigger, welche Spalte.

/* Hat die angemeldete Person die erweiterte Stufe?
   security definer ist hier Pflicht und kein Nachlassen: die Funktion wird
   aus einer Policy auf mitarbeiter heraus gerufen und liest dieselbe
   Tabelle. Als Eigentümer (postgres, ohne force row level security) läuft
   sie an RLS vorbei — sonst prüfte die Policy sich selbst und die Abfrage
   drehte sich im Kreis.
   search_path fest verdrahtet, damit niemand der Funktion eine eigene
   Tabelle namens mitarbeiter unterschieben kann. */
create or replace function public.ist_berechtigt()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.mitarbeiter
     where user_id = auth.uid()
       and geloescht_am is null
       and berechtigung in ('geschaeftsleitung', 'entwickler')
  );
$$;

revoke all on function public.ist_berechtigt() from public;
grant execute on function public.ist_berechtigt() to authenticated;

comment on function public.ist_berechtigt() is
  'Wahr, wenn die angemeldete Person die Stufe geschaeftsleitung oder entwickler hat. Gegenstueck zu istBerechtigt() in js/app.js.';

/* Welche Spalten geändert werden dürfen.
   Die Liste zählt auf, was erlaubt ist, nicht was verboten ist. Kommt
   später eine Spalte dazu, ist sie damit von selbst geschützt — bei einer
   Verbotsliste wäre sie von selbst offen, und das fiele niemandem auf. */
create or replace function public.mitarbeiter_schutz()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  erlaubt   text[] := array['telefon', 'email', 'unterschrift', 'unterschrift_am'];
  geaendert text[];
  verboten  text[];
begin
  -- Ohne angemeldetes Konto läuft der Aufruf aus dem Supabase-Dashboard
  -- oder über den Service-Key. Dort greift diese Schranke bewusst nicht,
  -- sonst käme die Administration an die eigene Tabelle nicht mehr heran.
  if auth.uid() is null then return new; end if;
  if public.ist_berechtigt() then return new; end if;

  if tg_op = 'INSERT' then
    if new.berechtigung is distinct from 'mitarbeiter' then
      raise exception 'Die Berechtigungsstufe vergibt nur die Geschaeftsleitung.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  select coalesce(array_agg(n.key), '{}')
    into geaendert
    from jsonb_each(to_jsonb(new)) n
    join jsonb_each(to_jsonb(old)) o on o.key = n.key
   where n.value is distinct from o.value;

  select array(select unnest(geaendert) except select unnest(erlaubt))
    into verboten;

  if array_length(verboten, 1) is null then return new; end if;

  raise exception
    'Ohne erweiterte Stufe lassen sich nur Telefon, E-Mail und Unterschrift der eigenen Zeile aendern. Abgelehnt: %.',
    array_to_string(verboten, ', ')
    using errcode = '42501';
end;
$$;

comment on function public.mitarbeiter_schutz() is
  'Spaltenschutz auf mitarbeiter. Die RLS-Policy entscheidet ueber die Zeile, dieser Trigger ueber die Spalte.';

drop trigger if exists mitarbeiter_schutz on public.mitarbeiter;
create trigger mitarbeiter_schutz
  before insert or update on public.mitarbeiter
  for each row execute function public.mitarbeiter_schutz();

/* Die Zeile: die eigene, oder jede, wenn die Stufe es hergibt.
   with check zusätzlich zu using, damit auch das Ergebnis der Änderung noch
   die eigene Zeile ist — ohne das liesse sich die eigene Zeile auf ein
   fremdes Konto umhängen. */
drop policy if exists mitarbeiter_update on public.mitarbeiter;
create policy mitarbeiter_update on public.mitarbeiter
  for update to authenticated
  using (user_id = auth.uid() or public.ist_berechtigt())
  with check (user_id = auth.uid() or public.ist_berechtigt());

drop policy if exists mitarbeiter_insert on public.mitarbeiter;
create policy mitarbeiter_insert on public.mitarbeiter
  for insert to authenticated
  with check (public.ist_berechtigt());

-- Lesen bleibt wie bisher offen: das Adressbuch geht alle an, und die
-- Unterschrift wird ab Schritt 14 auch in fremden Protokollen gebraucht.

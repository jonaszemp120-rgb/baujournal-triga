-- Admins in Gruppenchats.
--
-- Bisher durfte jedes Mitglied ein Gespräch für alle löschen. In einem
-- Einzelchat ist das richtig — wer mitredet, darf beenden, und es sind nur
-- zwei. In einer Gruppe mit acht Leuten ist es das nicht: dort löscht eine
-- Person den Verlauf von sieben anderen mit.
--
-- Also dieselbe Ordnung wie in den üblichen Messengern: wer die Gruppe
-- anlegt, führt sie, kann diese Rolle weitergeben, und nur sie löscht für
-- alle. Alle anderen können gehen, ohne die Gruppe mitzunehmen.
--
-- Im Einzelchat bleibt alles, wie es war. Das Häkchen spielt dort keine
-- Rolle, und niemand bekommt es.

alter table public.chat_mitglieder
  add column if not exists admin boolean not null default false;

comment on column public.chat_mitglieder.admin is
  'Nur in Gruppen: darf Mitglieder pflegen, weitere Admins ernennen und die Gruppe fuer alle loeschen. Im Einzelchat ohne Bedeutung.';

-- Bestand: wer eine Gruppe angelegt hat, führt sie auch weiterhin.
update public.chat_mitglieder m
   set admin = true
  from public.chats c
 where c.id = m.chat_id
   and c.art = 'gruppe'
   and c.erstellt_von = m.user_id
   and not m.admin;

/* --- Wer ist Admin -------------------------------------------------------- */

/* security definer, aus demselben Grund wie bei ist_chat_mitglied(): eine
   Policy auf chat_mitglieder darf chat_mitglieder nicht direkt lesen, die
   Abfrage drehte sich sonst im Kreis. */
create or replace function public.ist_chat_admin(p_chat uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.chat_mitglieder
     where chat_id = p_chat and user_id = auth.uid() and admin
  );
$$;

revoke all on function public.ist_chat_admin(uuid) from public;
grant execute on function public.ist_chat_admin(uuid) to authenticated;

comment on function public.ist_chat_admin(uuid) is
  'Wahr, wenn die angemeldete Person in diesem Gespraech Admin ist.';

/* --- Das Häkchen setzt die Datenbank -------------------------------------- */

/* Wer die Gruppe anlegt, ist Admin. Das setzt nicht die App, sondern diese
   Zeile: ein vergessenes Häkchen ergäbe eine Gruppe, die niemand mehr
   verwalten und niemand mehr löschen kann. */
create or replace function public.chat_ersteller_ist_admin()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not new.admin and exists (
    select 1 from public.chats
     where id = new.chat_id and art = 'gruppe' and erstellt_von = new.user_id
  ) then
    new.admin := true;
  end if;
  return new;
end $$;

drop trigger if exists chat_ersteller_ist_admin on public.chat_mitglieder;
create trigger chat_ersteller_ist_admin
  before insert on public.chat_mitglieder
  for each row execute function public.chat_ersteller_ist_admin();

/* Was sich an einer Mitgliedszeile ändern lässt, und zwar nur das. Eine
   Erlaubnisliste wie bei mitarbeiter_schutz() und antrag_schutz():

     an der eigenen Zeile   — der Lesestand
     an einer fremden Zeile — das Admin-Häkchen, und das nur als Admin

   Zum Admin macht einen also immer jemand anderes. Ohne diese Regel
   genügte ein einziger Aufruf an der Oberfläche vorbei, um sich selbst
   die Gruppe zu übernehmen. */
create or replace function public.chat_mitglied_schutz()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then return new; end if;

  if new.chat_id is distinct from old.chat_id
     or new.user_id is distinct from old.user_id
     or new.beigetreten_am is distinct from old.beigetreten_am then
    raise exception 'An einer Mitgliedszeile laesst sich nur der Lesestand oder das Admin-Haekchen aendern.'
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
    if not public.ist_chat_admin(new.chat_id) then
      raise exception 'Admins ernennt nur, wer selbst Admin ist.' using errcode = '42501';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists chat_mitglied_schutz on public.chat_mitglieder;
create trigger chat_mitglied_schutz
  before update on public.chat_mitglieder
  for each row execute function public.chat_mitglied_schutz();

/* Eine Gruppe ohne Admin wäre eine Gruppe, die niemand mehr verwaltet und
   niemand mehr löscht. Der letzte Admin geht deshalb nicht einfach — er
   ernennt zuerst jemand anderen.

   Steht das Gespräch selbst nicht mehr da, greift die Regel nicht: beim
   Löschen einer Gruppe räumt der Fremdschlüssel die Mitgliedszeilen ab,
   und dabei soll nichts dazwischenfunken. */
create or replace function public.chat_admin_bleibt()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  verliert boolean;
  weitere_admins integer;
  rest integer;
begin
  if tg_op = 'DELETE' then verliert := old.admin;
  else verliert := old.admin and not new.admin;
  end if;

  if verliert and exists (select 1 from public.chats where id = old.chat_id and art = 'gruppe') then
    select count(*) into weitere_admins from public.chat_mitglieder
     where chat_id = old.chat_id and admin and user_id <> old.user_id;
    select count(*) into rest from public.chat_mitglieder
     where chat_id = old.chat_id and user_id <> old.user_id;

    if weitere_admins = 0 and rest > 0 then
      raise exception 'Die Gruppe braucht einen Admin. Machen Sie zuerst jemand anderen zum Admin.'
        using errcode = '42501';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists chat_admin_bleibt on public.chat_mitglieder;
create trigger chat_admin_bleibt
  before update or delete on public.chat_mitglieder
  for each row execute function public.chat_admin_bleibt();

/* --- Die Regeln ----------------------------------------------------------- */

/* Der Kern der Sache. In der Gruppe löscht nur ein Admin für alle, im
   Einzelchat wie bisher jedes der beiden Mitglieder. art steht in
   derselben Zeile, dafür braucht es keine Unterabfrage. */
drop policy if exists chats_delete on public.chats;
create policy chats_delete on public.chats for delete to authenticated
  using (case art
           when 'gruppe' then public.ist_chat_admin(id)
           else public.ist_chat_mitglied(id)
         end);

-- Umbenennen ist Verwaltung und gehört damit zu denselben Leuten.
drop policy if exists chats_update on public.chats;
create policy chats_update on public.chats for update to authenticated
  using (public.ist_chat_admin(id)) with check (public.ist_chat_admin(id));

/* Mitglieder eintragen darf, wer die Gruppe angelegt hat oder Admin ist.
   Der Ersteller muss dabeistehen bleiben: beim allerersten Eintrag ist
   noch niemand Mitglied und damit auch niemand Admin. */
drop policy if exists mitglieder_insert on public.chat_mitglieder;
create policy mitglieder_insert on public.chat_mitglieder
  for insert to authenticated
  with check (
    public.ist_triga_person(user_id)
    and (public.ist_chat_ersteller(chat_id) or public.ist_chat_admin(chat_id))
  );

/* Austragen darf ein Admin jede Person — und jede Person sich selbst. Das
   Zweite ist das Austreten: die Gruppe bleibt für die übrigen bestehen. */
drop policy if exists mitglieder_delete on public.chat_mitglieder;
create policy mitglieder_delete on public.chat_mitglieder
  for delete to authenticated
  using (public.ist_chat_admin(chat_id) or user_id = auth.uid());

/* Ändern: die eigene Zeile immer (Lesestand), fremde nur als Admin
   (Häkchen). Was genau, hält der Trigger oben fest. */
drop policy if exists mitglieder_update on public.chat_mitglieder;
create policy mitglieder_update on public.chat_mitglieder
  for update to authenticated
  using (user_id = auth.uid() or public.ist_chat_admin(chat_id))
  with check (user_id = auth.uid() or public.ist_chat_admin(chat_id));

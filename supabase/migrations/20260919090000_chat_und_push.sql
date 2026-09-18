-- Chat und die Grundlage für Push-Benachrichtigungen.
--
-- Der Chat ist rein intern. Wer mitreden darf, entscheidet die
-- Mitgliedschaft an genau einem Ort: chat_mitglieder. Alles andere hängt
-- daran — welche Gespräche jemand sieht, welche Nachrichten er liest,
-- wohin eine Benachrichtigung geht.

/* --- Gespräche ----------------------------------------------------------- */

create table if not exists public.chats (
  id           uuid primary key default gen_random_uuid(),
  art          text not null check (art in ('einzel', 'gruppe')),
  -- Nur Gruppen tragen einen Namen. Ein Einzelchat heisst nach der
  -- anderen Person, und die steht schon in der Mitgliederliste; ein
  -- zweiter Ort dafür liefe früher oder später auseinander.
  name         text,
  erstellt_von uuid references auth.users(id) on delete set null,
  erstellt_am  timestamptz not null default now(),
  check (art = 'einzel' or name is not null)
);

create table if not exists public.chat_mitglieder (
  chat_id          uuid not null references public.chats(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  -- Der Ungelesen-Zähler ergibt sich daraus, nicht aus einer eigenen Zahl:
  -- alles nach diesem Zeitpunkt ist ungelesen. Eine gepflegte Zahl daneben
  -- wäre eine zweite Wahrheit, die beim ersten verlorenen Update abweicht.
  zuletzt_gelesen  timestamptz not null default '2000-01-01',
  beigetreten_am   timestamptz not null default now(),
  primary key (chat_id, user_id)
);

create table if not exists public.nachrichten (
  id          uuid primary key default gen_random_uuid(),
  chat_id     uuid not null references public.chats(id) on delete cascade,
  absender    uuid not null references auth.users(id) on delete cascade,
  text        text,
  -- Bilder leben 30 Tage. bild_pfad zeigt in den Bucket chat-bilder und
  -- wird beim Ablauf geleert; bild_ablauf bleibt stehen. Daran erkennt die
  -- App den Unterschied zwischen "war nie ein Bild" und "Bild ist weg".
  bild_pfad   text,
  bild_ablauf timestamptz,
  erstellt_am timestamptz not null default now(),
  check (text is not null or bild_ablauf is not null)
);

create index if not exists nachrichten_chat_idx on public.nachrichten (chat_id, erstellt_am);
create index if not exists chat_mitglieder_user_idx on public.chat_mitglieder (user_id);
create index if not exists nachrichten_ablauf_idx on public.nachrichten (bild_ablauf)
  where bild_pfad is not null;

/* --- Geräte für Benachrichtigungen --------------------------------------- */

/* Bewusst eigenständig und ohne Bezug zum Chat: ein Abo gehört einem Gerät,
   nicht einem Bereich. Wenn später eine zugewiesene Pendenz melden soll,
   braucht es hier keine Zeile mehr. */
create table if not exists public.push_geraete (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  endpunkt       text not null unique,
  p256dh         text not null,
  auth           text not null,
  erstellt_am    timestamptz not null default now(),
  zuletzt_gesehen timestamptz not null default now()
);

create index if not exists push_geraete_user_idx on public.push_geraete (user_id);

/* --- Wer gehört dazu ------------------------------------------------------ */

/* security definer, weil die Policy auf chat_mitglieder sonst sich selbst
   prüfen müsste und die Abfrage sich im Kreis drehte. Gleiche Begründung
   wie bei ist_berechtigt(). */
create or replace function public.ist_chat_mitglied(p_chat uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.chat_mitglieder
     where chat_id = p_chat and user_id = auth.uid()
  );
$$;

revoke all on function public.ist_chat_mitglied(uuid) from public;
grant execute on function public.ist_chat_mitglied(uuid) to authenticated;

/* Nur wer im Adressbuch steht, darf überhaupt chatten. Der Chat ist für die
   TRIGA-Mitarbeitenden, nicht für jedes Konto, das es je geben wird. */
create or replace function public.ist_triga_person(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.mitarbeiter
     where user_id = p_user and geloescht_am is null
  );
$$;

revoke all on function public.ist_triga_person(uuid) from public;
grant execute on function public.ist_triga_person(uuid) to authenticated;

/* --- RLS ------------------------------------------------------------------ */

alter table public.chats           enable row level security;
alter table public.chat_mitglieder enable row level security;
alter table public.nachrichten     enable row level security;
alter table public.push_geraete    enable row level security;

-- Gespräche: sehen und ändern darf nur, wer drin ist.
create policy chats_select on public.chats for select to authenticated
  using (public.ist_chat_mitglied(id));
create policy chats_insert on public.chats for insert to authenticated
  with check (erstellt_von = auth.uid() and public.ist_triga_person(auth.uid()));
-- Umbenennen darf, wer die Gruppe angelegt hat.
create policy chats_update on public.chats for update to authenticated
  using (erstellt_von = auth.uid()) with check (erstellt_von = auth.uid());

-- Mitglieder: die eigene Zeile immer, fremde nur in Gesprächen, die man
-- selbst angelegt hat. So kann niemand sich in ein fremdes Gespräch setzen.
create policy mitglieder_select on public.chat_mitglieder for select to authenticated
  using (public.ist_chat_mitglied(chat_id));
create policy mitglieder_insert on public.chat_mitglieder for insert to authenticated
  with check (
    public.ist_triga_person(user_id)
    and exists (select 1 from public.chats c
                 where c.id = chat_id and c.erstellt_von = auth.uid())
  );
-- Gelesen-Stand setzt jede Person nur bei sich selbst.
create policy mitglieder_update on public.chat_mitglieder for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy mitglieder_delete on public.chat_mitglieder for delete to authenticated
  using (exists (select 1 from public.chats c
                  where c.id = chat_id and c.erstellt_von = auth.uid()));

-- Nachrichten: lesen als Mitglied, schreiben als man selbst.
-- Kein Update, kein Delete: Nachrichten lassen sich in diesem Schritt
-- bewusst weder ändern noch löschen, und was es nicht geben soll, bekommt
-- gar keine Policy.
create policy nachrichten_select on public.nachrichten for select to authenticated
  using (public.ist_chat_mitglied(chat_id));
create policy nachrichten_insert on public.nachrichten for insert to authenticated
  with check (absender = auth.uid() and public.ist_chat_mitglied(chat_id));

-- Geräte: jede Person verwaltet nur die eigenen.
create policy geraete_select on public.push_geraete for select to authenticated
  using (user_id = auth.uid());
create policy geraete_insert on public.push_geraete for insert to authenticated
  with check (user_id = auth.uid());
create policy geraete_update on public.push_geraete for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy geraete_delete on public.push_geraete for delete to authenticated
  using (user_id = auth.uid());

/* --- Echtzeit ------------------------------------------------------------- */

/* Ohne das kommt keine Nachricht an, ohne dass jemand neu lädt. */
alter publication supabase_realtime add table public.nachrichten;
alter publication supabase_realtime add table public.chat_mitglieder;

/* --- Bildablage ----------------------------------------------------------- */

insert into storage.buckets (id, name, public)
values ('chat-bilder', 'chat-bilder', false)
on conflict (id) do nothing;

/* Ein Bild liegt unter <chat_id>/<zufall>.<endung>. Der erste Ordner ist
   also die Gesprächs-ID, und damit hängt auch der Zugriff auf das Bild an
   derselben Mitgliedschaft wie das Gespräch selbst. */
drop policy if exists chatbilder_select on storage.objects;
create policy chatbilder_select on storage.objects for select to authenticated
  using (bucket_id = 'chat-bilder'
         and public.ist_chat_mitglied(((storage.foldername(name))[1])::uuid));

drop policy if exists chatbilder_insert on storage.objects;
create policy chatbilder_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-bilder'
              and public.ist_chat_mitglied(((storage.foldername(name))[1])::uuid));

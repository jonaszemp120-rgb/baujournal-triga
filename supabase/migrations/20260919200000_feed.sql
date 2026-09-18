-- Der Feed: Beiträge und Umfragen für das ganze Haus.
--
-- Ein einziger Strom, chronologisch, sichtbar für alle TRIGA-Leute. Zwei
-- Arten darin: ein Beitrag (Text, optional Foto, optional einem Projekt
-- zugeordnet) und eine Umfrage (Frage plus Antwortmöglichkeiten). Beide
-- liegen in derselben Tabelle, weil sie im selben Strom stehen und
-- dieselben Herzen und Kommentare tragen. Zwei Tabellen hiessen: jede
-- Abfrage zweimal, jede Sortierung von Hand zusammengefügt.
--
-- Gelöscht wird hier wirklich gelöscht, ohne Papierkorb. Das ist der
-- Unterschied zum Baujournal und ausdrücklich so gewollt: ein Beitrag ist
-- kein Dokument mit Aufbewahrungsfrist, und wer sich vertippt, postet neu.
-- Die Regel auf eintraege bleibt davon unberührt.

/* --- Beiträge und Umfragen ------------------------------------------------ */

create table if not exists public.feed_beitraege (
  id           uuid primary key default gen_random_uuid(),
  art          text not null check (art in ('beitrag', 'umfrage')),

  -- Nur ein Beitrag trägt eine Kategorie. Bei einer Umfrage steht an
  -- derselben Stelle das Wort "Umfrage", eine Kategorie daneben wäre
  -- eine Angabe, die nirgends erscheint und trotzdem gepflegt werden will.
  kategorie    text check (kategorie in ('update', 'wichtig')),
  check ((art = 'beitrag') = (kategorie is not null)),

  -- Beim Beitrag der Text, bei der Umfrage die Frage. Dieselbe Spalte,
  -- weil es an derselben Stelle steht und dieselbe Rolle spielt.
  text         text,

  -- Fotos leben 30 Tage, genau wie im Chat. bild_pfad zeigt in den Bucket
  -- feed-bilder und wird beim Ablauf geleert, bild_ablauf bleibt stehen.
  -- Daran erkennt die App den Unterschied zwischen "war nie ein Foto" und
  -- "Foto ist weg".
  bild_pfad    text,
  bild_ablauf  timestamptz,

  -- Eine Umfrage braucht ihre Frage. Ein Beitrag braucht Text oder Foto,
  -- sonst wäre er leer.
  check (case art
           when 'umfrage' then text is not null
           else text is not null or bild_ablauf is not null
         end),

  -- Die Zuordnung zu einem Projekt gibt es nur beim Beitrag. Der Dialog
  -- bietet sie auch nur dort an, und was die App nicht anbietet, soll die
  -- Datenbank nicht stillschweigend zulassen.
  projekt_id   uuid references public.projekte(id) on delete set null,
  check (art = 'beitrag' or projekt_id is null),

  -- Anonym abstimmen gibt es nur bei der Umfrage.
  anonym       boolean not null default false,
  check (art = 'umfrage' or anonym = false),

  erstellt_von uuid not null references auth.users(id) on delete cascade,
  erstellt_am  timestamptz not null default now()
);

create index if not exists feed_beitraege_zeit_idx on public.feed_beitraege (erstellt_am desc);
create index if not exists feed_beitraege_projekt_idx on public.feed_beitraege (projekt_id)
  where projekt_id is not null;
create index if not exists feed_beitraege_ablauf_idx on public.feed_beitraege (bild_ablauf)
  where bild_pfad is not null;

create table if not exists public.feed_optionen (
  id           uuid primary key default gen_random_uuid(),
  beitrag_id   uuid not null references public.feed_beitraege(id) on delete cascade,
  text         text not null check (length(btrim(text)) between 1 and 120),
  reihenfolge  smallint not null default 0
);

create index if not exists feed_optionen_beitrag_idx on public.feed_optionen (beitrag_id, reihenfolge);

/* Eine Stimme pro Person und Umfrage, und zwar durch den Primärschlüssel
   und nicht durch eine Prüfung in der App. Eine zweite Stimme kommt gar
   nicht erst in die Tabelle, egal wer sie schickt und mit welchem Mittel. */
create table if not exists public.feed_stimmen (
  beitrag_id  uuid not null references public.feed_beitraege(id) on delete cascade,
  option_id   uuid not null references public.feed_optionen(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  erstellt_am timestamptz not null default now(),
  primary key (beitrag_id, user_id)
);

create index if not exists feed_stimmen_option_idx on public.feed_stimmen (option_id);

create table if not exists public.feed_reaktionen (
  beitrag_id  uuid not null references public.feed_beitraege(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  erstellt_am timestamptz not null default now(),
  primary key (beitrag_id, user_id)
);

create table if not exists public.feed_kommentare (
  id          uuid primary key default gen_random_uuid(),
  beitrag_id  uuid not null references public.feed_beitraege(id) on delete cascade,
  verfasser   uuid not null references auth.users(id) on delete cascade,
  text        text not null check (length(btrim(text)) between 1 and 2000),
  erstellt_am timestamptz not null default now()
);

create index if not exists feed_kommentare_beitrag_idx on public.feed_kommentare (beitrag_id, erstellt_am);

/* --- Hilfsfunktionen ------------------------------------------------------ */

/* Alle security definer, und zwar aus demselben Grund wie bei
   ist_chat_mitglied(): eine Policy darf keine andere Tabelle mit
   Zeilensicherheit direkt abfragen. Sonst prüft die eine Policy die
   nächste, und irgendwann dreht sich die Abfrage im Kreis oder gibt
   stillschweigend nichts heraus.
   search_path fest verdrahtet, damit niemand der Funktion eine eigene
   Tabelle unterschieben kann. */

create or replace function public.feed_ist_autor(p_beitrag uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.feed_beitraege
     where id = p_beitrag and erstellt_von = auth.uid()
  );
$$;

/* Löschen darf, wer geschrieben hat — und zusätzlich die erweiterte Stufe,
   als einfache Moderation. Kommentare gehören ausdrücklich dazu: wer einen
   ganzen Beitrag entfernen darf, soll nicht den Umweg gehen müssen, den
   Beitrag zu löschen, um einen Kommentar darunter loszuwerden. */
create or replace function public.feed_darf_loeschen(p_beitrag uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.feed_ist_autor(p_beitrag) or public.ist_berechtigt();
$$;

create or replace function public.feed_ist_anonym(p_beitrag uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce((select anonym from public.feed_beitraege where id = p_beitrag), false);
$$;

/* Gehört die Option zu genau dieser Umfrage? Ohne das könnte jemand seine
   Stimme unter der Kennung der einen Umfrage auf die Option einer anderen
   legen, und beide Auswertungen wären falsch. */
create or replace function public.feed_option_passt(p_option uuid, p_beitrag uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.feed_optionen
     where id = p_option and beitrag_id = p_beitrag
  );
$$;

/* Das Ergebnis aller Umfragen auf einen Schlag: je Option die Anzahl
   Stimmen, sonst nichts.
   Hier liegt die Anonymität. Die Zeilen in feed_stimmen tragen zwingend
   eine Person, sonst liessen sich Mehrfachstimmen nicht verhindern — aber
   herausgegeben werden sie nie. Diese Funktion gibt nur Zahlen zurück,
   und die Policy auf feed_stimmen zeigt bei einer anonymen Umfrage
   niemandem eine fremde Zeile, auch der erstellenden Person nicht. */
create or replace function public.feed_ergebnisse()
returns table (beitrag_id uuid, option_id uuid, stimmen bigint)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select s.beitrag_id, s.option_id, count(*)::bigint
    from public.feed_stimmen s
   where public.ist_triga_person(auth.uid())
   group by s.beitrag_id, s.option_id;
$$;

/* Für die Bildablage. Beim Hochladen gibt es den Beitrag noch nicht: die
   Kennung wird in der App gewürfelt, das Foto liegt zuerst, die Zeile
   folgt. Darum zählt eine fehlende Zeile als erlaubt — sie gehört dann
   niemandem, und wenn das Anlegen scheitert, räumt die App die Datei
   gleich wieder weg. */
create or replace function public.feed_darf_bild(p_beitrag uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select case
    when not public.ist_triga_person(auth.uid()) then false
    when not exists (select 1 from public.feed_beitraege where id = p_beitrag) then true
    else public.feed_darf_loeschen(p_beitrag)
  end;
$$;

revoke all on function public.feed_ist_autor(uuid) from public;
revoke all on function public.feed_darf_loeschen(uuid) from public;
revoke all on function public.feed_ist_anonym(uuid) from public;
revoke all on function public.feed_option_passt(uuid, uuid) from public;
revoke all on function public.feed_ergebnisse() from public;
revoke all on function public.feed_darf_bild(uuid) from public;

grant execute on function public.feed_ist_autor(uuid) to authenticated;
grant execute on function public.feed_darf_loeschen(uuid) to authenticated;
grant execute on function public.feed_ist_anonym(uuid) to authenticated;
grant execute on function public.feed_option_passt(uuid, uuid) to authenticated;
grant execute on function public.feed_ergebnisse() to authenticated;
grant execute on function public.feed_darf_bild(uuid) to authenticated;

comment on function public.feed_ergebnisse() is
  'Je Umfrage und Option die Anzahl Stimmen. Gibt nie heraus, wer wie gestimmt hat.';

/* --- RLS ------------------------------------------------------------------ */

alter table public.feed_beitraege  enable row level security;
alter table public.feed_optionen   enable row level security;
alter table public.feed_stimmen    enable row level security;
alter table public.feed_reaktionen enable row level security;
alter table public.feed_kommentare enable row level security;

-- Beiträge: lesen darf das ganze Haus, schreiben jede Person für sich.
-- Kein Update: ein Beitrag lässt sich nicht nachträglich ändern, und was es
-- nicht geben soll, bekommt gar keine Policy.
create policy feed_select on public.feed_beitraege for select to authenticated
  using (public.ist_triga_person(auth.uid()));
create policy feed_insert on public.feed_beitraege for insert to authenticated
  with check (erstellt_von = auth.uid() and public.ist_triga_person(auth.uid()));
create policy feed_delete on public.feed_beitraege for delete to authenticated
  using (erstellt_von = auth.uid() or public.ist_berechtigt());

-- Optionen: legt an, wer die Umfrage angelegt hat. Geändert werden sie nie,
-- gelöscht werden sie mit der Umfrage (on delete cascade).
create policy feed_optionen_select on public.feed_optionen for select to authenticated
  using (public.ist_triga_person(auth.uid()));
create policy feed_optionen_insert on public.feed_optionen for insert to authenticated
  with check (public.feed_ist_autor(beitrag_id));

/* Stimmen: die eigene sieht man immer. Fremde nur, wenn die Umfrage nicht
   anonym ist — und angezeigt werden sie auch dann nirgends, die App rechnet
   mit feed_ergebnisse(). Kein Update, kein Delete: eine abgegebene Stimme
   steht. */
create policy feed_stimmen_select on public.feed_stimmen for select to authenticated
  using (user_id = auth.uid() or not public.feed_ist_anonym(beitrag_id));
create policy feed_stimmen_insert on public.feed_stimmen for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.ist_triga_person(auth.uid())
    and public.feed_option_passt(option_id, beitrag_id)
  );

-- Herzen: jede Person setzt und entfernt nur ihr eigenes.
create policy feed_reaktionen_select on public.feed_reaktionen for select to authenticated
  using (public.ist_triga_person(auth.uid()));
create policy feed_reaktionen_insert on public.feed_reaktionen for insert to authenticated
  with check (user_id = auth.uid() and public.ist_triga_person(auth.uid()));
create policy feed_reaktionen_delete on public.feed_reaktionen for delete to authenticated
  using (user_id = auth.uid());

-- Kommentare: schreiben für sich, löschen eigene oder als Moderation.
create policy feed_kommentare_select on public.feed_kommentare for select to authenticated
  using (public.ist_triga_person(auth.uid()));
create policy feed_kommentare_insert on public.feed_kommentare for insert to authenticated
  with check (verfasser = auth.uid() and public.ist_triga_person(auth.uid()));
create policy feed_kommentare_delete on public.feed_kommentare for delete to authenticated
  using (verfasser = auth.uid() or public.ist_berechtigt());

/* --- Bildablage ----------------------------------------------------------- */

insert into storage.buckets (id, name, public)
values ('feed-bilder', 'feed-bilder', false)
on conflict (id) do nothing;

/* Ein Foto liegt unter <beitrag_id>/<zufall>.<endung>. Der erste Ordner ist
   die Kennung des Beitrags, damit hängt der Zugriff auf die Datei an
   derselben Regel wie der Beitrag selbst. */
drop policy if exists feedbilder_select on storage.objects;
create policy feedbilder_select on storage.objects for select to authenticated
  using (bucket_id = 'feed-bilder' and public.ist_triga_person(auth.uid()));

drop policy if exists feedbilder_insert on storage.objects;
create policy feedbilder_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'feed-bilder'
              and public.feed_darf_bild(((storage.foldername(name))[1])::uuid));

drop policy if exists feedbilder_delete on storage.objects;
create policy feedbilder_delete on storage.objects for delete to authenticated
  using (bucket_id = 'feed-bilder'
         and public.feed_darf_bild(((storage.foldername(name))[1])::uuid));

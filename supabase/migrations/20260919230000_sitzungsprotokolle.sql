-- Sitzungsprotokolle je Projekt.
--
-- Derselbe Gedanke wie bei der Bauabnahme: etwas wird vorbereitet, in der
-- Sitzung gefüllt, und am Schluss ist es ein Nachweis und kein Entwurf
-- mehr. Was danach gilt, hält die Datenbank fest und nicht die Oberfläche.
--
-- Drei Tabellen, weil es drei Dinge sind, die unterschiedlich oft
-- vorkommen: ein Protokoll, seine Teilnehmenden, seine Traktanden.

/* --- Das Protokoll --------------------------------------------------------- */

/* Die Nummer läuft pro Projekt und steht auf dem Titel: "Baubesprechung
   Nr. 12". Sie steckt deshalb in einer eigenen Spalte und nicht im Text —
   sonst müsste man sie beim Zählen aus einer Zeichenkette klauben.
   bezeichnung ist der Teil davor und bleibt änderbar; nicht jede Sitzung
   ist eine Baubesprechung. */
create table if not exists public.protokolle (
  id           uuid primary key default gen_random_uuid(),
  projekt_id   uuid not null references public.projekte(id) on delete cascade,
  nummer       smallint not null check (nummer >= 1),
  bezeichnung  text not null default 'Baubesprechung'
               check (length(btrim(bezeichnung)) between 1 and 80),
  datum        date not null,
  ort          text check (ort is null or length(btrim(ort)) <= 120),

  /* Vorbereitet: die Traktandenliste steht, die Sitzung war noch nicht.
     Entwurf: es wird festgehalten. Abgeschlossen: das PDF ist der
     massgebende Stand, und ab hier ändert sich nichts mehr. */
  status       text not null default 'vorbereitet'
               check (status in ('vorbereitet', 'entwurf', 'abgeschlossen')),
  abgeschlossen_am timestamptz,
  pdf_datei_id uuid references public.dateien(id) on delete set null,

  erstellt_von uuid not null references auth.users(id) on delete cascade,
  erstellt_am  timestamptz not null default now(),

  -- Abgeschlossen heisst abgeschlossen: Status und Zeitpunkt gehören zusammen.
  check ((status = 'abgeschlossen') = (abgeschlossen_am is not null)),
  unique (projekt_id, nummer)
);

create index if not exists protokolle_projekt_idx
  on public.protokolle (projekt_id, datum desc, nummer desc);

/* Die Nummer vergibt die Datenbank, nicht die App: zwei Geräte, die im
   selben Moment ein Protokoll anlegen, würden sonst beide die gleiche
   nehmen. Security definer, weil die Zeilen anderer Leute mitgezählt
   werden müssen — die Regel unten lässt zwar alle alles sehen, aber
   darauf soll sich das Zählen nicht verlassen.
   Bleiben trotzdem zwei Einfügungen exakt gleichzeitig stehen, greift der
   eindeutige Index und eine der beiden scheitert laut statt still. */
create or replace function public.protokoll_nummer()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.nummer is null then
    select coalesce(max(nummer), 0) + 1 into new.nummer
      from public.protokolle where projekt_id = new.projekt_id;
  end if;
  return new;
end $$;

drop trigger if exists protokoll_nummer_trigger on public.protokolle;
create trigger protokoll_nummer_trigger
  before insert on public.protokolle
  for each row execute function public.protokoll_nummer();

/* --- Teilnehmende ---------------------------------------------------------- */

/* Wer dabei war, kommt aus dem Adressbuch: entweder aus den TRIGA-
   Mitarbeitenden oder aus den Ansprechpersonen der Unternehmerliste.
   Genau eines von beiden, sonst wüsste niemand, welcher Name gilt.

   Name und Firma stehen trotzdem als eigene Spalten daneben. Das ist
   keine Verdopplung aus Bequemlichkeit, sondern dieselbe Momentaufnahme
   wie bei den Kontrollpunkten im Baujournal: das Protokoll hält fest, wer
   an jenem Tag am Tisch sass. Wird die Person später umbenannt oder aus
   dem Adressbuch entfernt, bleibt der Nachweis lesbar. */
create table if not exists public.protokoll_teilnehmer (
  id              uuid primary key default gen_random_uuid(),
  protokoll_id    uuid not null references public.protokolle(id) on delete cascade,
  mitarbeiter_id  uuid references public.mitarbeiter(id) on delete set null,
  ansprechperson_id uuid references public.ansprechpersonen(id) on delete set null,
  name            text not null check (length(btrim(name)) between 1 and 120),
  firma           text,
  status          text not null default 'anwesend'
                  check (status in ('vorsitz', 'anwesend', 'abwesend', 'verteiler')),
  erstellt_am     timestamptz not null default now()
);

create index if not exists teilnehmer_protokoll_idx
  on public.protokoll_teilnehmer (protokoll_id, erstellt_am);

/* Niemand steht zweimal auf derselben Liste. Teilindexe, weil jeweils
   nur eine der beiden Spalten belegt ist und NULL sich nicht mit NULL
   beisst. */
create unique index if not exists teilnehmer_mitarbeiter_eindeutig
  on public.protokoll_teilnehmer (protokoll_id, mitarbeiter_id)
  where mitarbeiter_id is not null;
create unique index if not exists teilnehmer_ansprech_eindeutig
  on public.protokoll_teilnehmer (protokoll_id, ansprechperson_id)
  where ansprechperson_id is not null;

/* --- Traktanden ------------------------------------------------------------ */

/* reihenfolge und nicht nummer: die angezeigte Zahl ist die Position in
   der Liste und wird beim Zeichnen gezählt. Stünde sie in der Zeile,
   müsste beim Verschieben jede Zahl darunter mitwandern — und zwischen
   zwei Schreibvorgängen gäbe es die Nummer 3 zweimal oder gar nicht.
   Getauscht wird mit traktandum_schieben() unten, in einem Zug. */
create table if not exists public.protokoll_traktanden (
  id           uuid primary key default gen_random_uuid(),
  protokoll_id uuid not null references public.protokolle(id) on delete cascade,
  reihenfolge  integer not null,
  titel        text not null check (length(btrim(titel)) between 1 and 200),
  text         text,
  foto_pfad    text,
  beschluss    boolean not null default false,
  /* Die Pendenz lebt in der Pendenzenliste des Projekts, hier steht nur
     der Verweis. Eine zweite Liste wäre eine zweite Wahrheit. */
  pendenz_id   uuid references public.pendenzen(id) on delete set null,
  erstellt_von uuid not null references auth.users(id) on delete cascade,
  erstellt_am  timestamptz not null default now()
);

create index if not exists traktanden_protokoll_idx
  on public.protokoll_traktanden (protokoll_id, reihenfolge, erstellt_am);

/* --- Die Sperre nach dem Abschluss ----------------------------------------- */

create or replace function public.protokoll_zu(p_protokoll uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.protokolle
     where id = p_protokoll and abgeschlossen_am is not null
  );
$$;

/* Ein Trigger für drei Tabellen. OLD und NEW sind nicht immer beide da —
   beim Einfügen fehlt OLD, beim Löschen NEW —, deshalb die
   ausgeschriebenen Zweige statt eines coalesce über beide.
   Dieselbe Bauart wie abnahme_gesperrt() bei der Bauabnahme. */
create or replace function public.protokoll_gesperrt()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  welches uuid;
begin
  if tg_table_name = 'protokolle' then
    if old.abgeschlossen_am is not null then
      if tg_op = 'DELETE' then
        raise exception 'Ein abgeschlossenes Protokoll laesst sich nicht loeschen.';
      end if;
      raise exception 'Dieses Protokoll ist abgeschlossen und laesst sich nicht mehr aendern.';
    end if;
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then welches := old.protokoll_id; else welches := new.protokoll_id; end if;
  if not public.protokoll_zu(welches) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  /* Eine einzige Ausnahme, und zwar an den Traktanden: verschwindet eine
     Pendenz aus der Projektliste, darf ihre Spur hier verblassen. Ohne
     diese Lücke liesse sich eine Pendenz, die einmal aus einem
     abgeschlossenen Protokoll entstanden ist, nie mehr löschen — das
     Fremdschlüssel-Aufräumen würde an der Sperre scheitern.
     Erlaubt ist ausschliesslich dieser eine Schritt: alles andere muss
     unverändert bleiben, geprüft als Erlaubnisliste wie bei
     antrag_schutz(). */
  if tg_table_name = 'protokoll_traktanden' and tg_op = 'UPDATE'
     and old.pendenz_id is not null and new.pendenz_id is null
     and new.titel       is not distinct from old.titel
     and new.text        is not distinct from old.text
     and new.foto_pfad   is not distinct from old.foto_pfad
     and new.beschluss   is not distinct from old.beschluss
     and new.reihenfolge is not distinct from old.reihenfolge
     and new.protokoll_id is not distinct from old.protokoll_id then
    return new;
  end if;

  raise exception 'Das Protokoll ist abgeschlossen, daran laesst sich nichts mehr aendern.';
end $$;

drop trigger if exists protokoll_gesperrt_trigger on public.protokolle;
create trigger protokoll_gesperrt_trigger
  before update or delete on public.protokolle
  for each row execute function public.protokoll_gesperrt();

drop trigger if exists teilnehmer_gesperrt_trigger on public.protokoll_teilnehmer;
create trigger teilnehmer_gesperrt_trigger
  before insert or update or delete on public.protokoll_teilnehmer
  for each row execute function public.protokoll_gesperrt();

drop trigger if exists traktanden_gesperrt_trigger on public.protokoll_traktanden;
create trigger traktanden_gesperrt_trigger
  before insert or update or delete on public.protokoll_traktanden
  for each row execute function public.protokoll_gesperrt();

/* --- Umordnen -------------------------------------------------------------- */

/* Zwei Traktanden tauschen die Plätze, und zwar in einem Zug. Über zwei
   einzelne Aufrufe aus der App ginge dazwischen der zweite schief und die
   Liste stünde krumm da.
   Security definer, aber mit eigener Prüfung: wer kein Eintrag im Bereich
   Mitarbeiter hat, kommt hier so wenig durch wie über die Regeln unten. */
create or replace function public.traktandum_schieben(p_traktandum uuid, p_hoch boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  mich   public.protokoll_traktanden%rowtype;
  andere public.protokoll_traktanden%rowtype;
begin
  if not public.ist_triga_person(auth.uid()) then
    raise exception 'Dafuer fehlt die Berechtigung.';
  end if;

  select * into mich from public.protokoll_traktanden where id = p_traktandum;
  if not found then
    raise exception 'Dieses Traktandum gibt es nicht.';
  end if;
  if public.protokoll_zu(mich.protokoll_id) then
    raise exception 'Das Protokoll ist abgeschlossen, daran laesst sich nichts mehr aendern.';
  end if;

  /* Der Nachbar in der gewünschten Richtung. erstellt_am entscheidet,
     wenn zwei dieselbe Reihenfolge tragen — passieren kann das nach einem
     abgebrochenen Tausch, und dann soll trotzdem etwas Sinnvolles
     herauskommen. */
  if p_hoch then
    select * into andere from public.protokoll_traktanden
     where protokoll_id = mich.protokoll_id
       and (reihenfolge, erstellt_am) < (mich.reihenfolge, mich.erstellt_am)
     order by reihenfolge desc, erstellt_am desc limit 1;
  else
    select * into andere from public.protokoll_traktanden
     where protokoll_id = mich.protokoll_id
       and (reihenfolge, erstellt_am) > (mich.reihenfolge, mich.erstellt_am)
     order by reihenfolge, erstellt_am limit 1;
  end if;
  if not found then return; end if;   -- schon ganz oben oder ganz unten

  update public.protokoll_traktanden set reihenfolge = andere.reihenfolge where id = mich.id;
  update public.protokoll_traktanden set reihenfolge = mich.reihenfolge   where id = andere.id;
end $$;

revoke all on function public.protokoll_zu(uuid) from public;
revoke all on function public.traktandum_schieben(uuid, boolean) from public;
grant execute on function public.protokoll_zu(uuid) to authenticated;
grant execute on function public.traktandum_schieben(uuid, boolean) to authenticated;

/* --- Regeln ---------------------------------------------------------------- */

alter table public.protokolle            enable row level security;
alter table public.protokoll_teilnehmer  enable row level security;
alter table public.protokoll_traktanden  enable row level security;

/* Wie bei der Bauabnahme das ganze Haus: ein Sitzungsprotokoll ist Arbeit
   am Projekt und nicht Privatsache, wer vertritt, muss weiterführen
   können. Was nach dem Abschluss noch geht, entscheidet der Trigger. */
create policy protokolle_select on public.protokolle for select to authenticated
  using (public.ist_triga_person(auth.uid()));
create policy protokolle_insert on public.protokolle for insert to authenticated
  with check (erstellt_von = auth.uid() and public.ist_triga_person(auth.uid())
              and status <> 'abgeschlossen');
create policy protokolle_update on public.protokolle for update to authenticated
  using (public.ist_triga_person(auth.uid()))
  with check (public.ist_triga_person(auth.uid()));
-- Vorbereitet oder Entwurf darf weg, abgeschlossen nicht. Der Trigger
-- sagt es zusätzlich mit einer Fehlermeldung; eine Regel, die nicht
-- trifft, schweigt nur.
create policy protokolle_delete on public.protokolle for delete to authenticated
  using (public.ist_triga_person(auth.uid()) and abgeschlossen_am is null);

create policy teilnehmer_select on public.protokoll_teilnehmer for select to authenticated
  using (public.ist_triga_person(auth.uid()));
create policy teilnehmer_insert on public.protokoll_teilnehmer for insert to authenticated
  with check (public.ist_triga_person(auth.uid()));
create policy teilnehmer_update on public.protokoll_teilnehmer for update to authenticated
  using (public.ist_triga_person(auth.uid()))
  with check (public.ist_triga_person(auth.uid()));
create policy teilnehmer_delete on public.protokoll_teilnehmer for delete to authenticated
  using (public.ist_triga_person(auth.uid()));

create policy traktanden_select on public.protokoll_traktanden for select to authenticated
  using (public.ist_triga_person(auth.uid()));
create policy traktanden_insert on public.protokoll_traktanden for insert to authenticated
  with check (erstellt_von = auth.uid() and public.ist_triga_person(auth.uid()));
create policy traktanden_update on public.protokoll_traktanden for update to authenticated
  using (public.ist_triga_person(auth.uid()))
  with check (public.ist_triga_person(auth.uid()));
create policy traktanden_delete on public.protokoll_traktanden for delete to authenticated
  using (public.ist_triga_person(auth.uid()));

/* --- Die Ablage ------------------------------------------------------------ */

insert into storage.buckets (id, name, public)
values ('protokoll', 'protokoll', false)
on conflict (id) do nothing;

/* Die Fotos liegen unter <protokoll_id>/… Sehen und ablegen darf das
   ganze Haus, entfernen nur, solange das Protokoll offen ist — sonst
   fehlte dem fertigen PDF nachträglich ein Bild, das darin abgedruckt
   ist. Genau dasselbe Muster wie beim Bucket der Bauabnahme. */
drop policy if exists protokoll_select on storage.objects;
create policy protokoll_select on storage.objects for select to authenticated
  using (bucket_id = 'protokoll' and public.ist_triga_person(auth.uid()));

drop policy if exists protokoll_insert on storage.objects;
create policy protokoll_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'protokoll' and public.ist_triga_person(auth.uid()));

drop policy if exists protokoll_delete on storage.objects;
create policy protokoll_delete on storage.objects for delete to authenticated
  using (bucket_id = 'protokoll'
         and public.ist_triga_person(auth.uid())
         and not public.protokoll_zu(((storage.foldername(name))[1])::uuid));

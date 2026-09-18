-- Formulare und Bauabnahme.
--
-- Zwei Dinge, die auf denselben Gedanken hinauslaufen: etwas wird erfasst,
-- jemand entscheidet oder unterschreibt, und danach ist es ein Nachweis und
-- kein Entwurf mehr. Genau das steht hier in der Datenbank und nicht nur in
-- der Oberfläche — ein entschiedener Antrag und eine unterschriebene
-- Abnahme lassen sich auch dann nicht mehr ändern, wenn jemand die App
-- umgeht.

/* --- Anträge -------------------------------------------------------------- */

/* Spesen und Ferien in einer Tabelle, unterschieden durch art. Beide
   durchlaufen denselben Weg — eingereicht, dann genehmigt oder abgelehnt —
   und stehen in derselben Liste. Zwei Tabellen hiessen zwei Abfragen für
   eine Liste und zwei Stellen, an denen der Status gepflegt wird.
   Die Prüfregel unten hält trotzdem auseinander, was nur zur einen Art
   gehört: ein Ferienantrag hat keinen Betrag, ein Spesenantrag keinen
   Zeitraum. */
create table if not exists public.antraege (
  id           uuid primary key default gen_random_uuid(),
  art          text not null check (art in ('spesen', 'ferien')),

  -- Spesen
  betrag       numeric(10,2),
  beschrieb    text,
  beleg_pfad   text,

  -- Ferien
  von          date,
  bis          date,
  bemerkung    text,

  status       text not null default 'eingereicht'
               check (status in ('eingereicht', 'genehmigt', 'abgelehnt')),
  entschieden_von uuid references auth.users(id) on delete set null,
  entschieden_am  timestamptz,

  erstellt_von uuid not null references auth.users(id) on delete cascade,
  erstellt_am  timestamptz not null default now(),

  check (case art
    when 'spesen' then betrag is not null and betrag > 0
                       and beschrieb is not null and length(btrim(beschrieb)) > 0
                       and von is null and bis is null and bemerkung is null
    else von is not null and bis is not null and bis >= von
         and betrag is null and beschrieb is null and beleg_pfad is null
  end),

  -- Entschieden heisst entschieden: Status und Zeitpunkt gehören zusammen.
  check ((status = 'eingereicht') = (entschieden_am is null))
);

create index if not exists antraege_person_idx on public.antraege (erstellt_von, erstellt_am desc);
create index if not exists antraege_offen_idx on public.antraege (erstellt_am desc)
  where status = 'eingereicht';

/* Was sich an einem Antrag ändern lässt, und zwar nur das.
   Dieselbe Bauart wie mitarbeiter_schutz(): eine Erlaubnisliste statt
   einer Verbotsliste. Wer entscheidet, entscheidet — den Betrag oder den
   Zeitraum eines fremden Antrags soll dabei niemand mit anpassen können,
   auch die Geschäftsleitung nicht. Und ein einmal entschiedener Antrag ist
   ein Nachweis und bleibt, wie er ist. */
create or replace function public.antrag_schutz()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status <> 'eingereicht' then
    raise exception 'Ein entschiedener Antrag laesst sich nicht mehr aendern.';
  end if;

  if new.art          is distinct from old.art
     or new.betrag    is distinct from old.betrag
     or new.beschrieb is distinct from old.beschrieb
     or new.beleg_pfad is distinct from old.beleg_pfad
     or new.von       is distinct from old.von
     or new.bis       is distinct from old.bis
     or new.bemerkung is distinct from old.bemerkung
     or new.erstellt_von is distinct from old.erstellt_von
     or new.erstellt_am  is distinct from old.erstellt_am then
    raise exception 'An einem Antrag laesst sich nur der Entscheid setzen, nicht sein Inhalt.';
  end if;

  if new.status = 'eingereicht' then
    raise exception 'Ein Entscheid nimmt sich nicht zurueck.';
  end if;

  -- Wer entscheidet, steht in der Zeile, und zwar als die Person, die es tut.
  new.entschieden_von := auth.uid();
  new.entschieden_am  := coalesce(new.entschieden_am, now());
  return new;
end $$;

drop trigger if exists antrag_schutz_trigger on public.antraege;
create trigger antrag_schutz_trigger
  before update on public.antraege
  for each row execute function public.antrag_schutz();

/* --- Bauabnahme ----------------------------------------------------------- */

/* Eine Abnahme gehört einem Projekt und einem Plan. Der Plan liegt als PDF
   oder Bild in den Projekt-Dokumenten; plan_bild_pfad zeigt auf die einmal
   gerenderte Fassung im Bucket, denn auf ein PDF lässt sich keine
   Stecknadel zuverlässig setzen. */
create table if not exists public.abnahmen (
  id             uuid primary key default gen_random_uuid(),
  projekt_id     uuid not null references public.projekte(id) on delete cascade,
  titel          text not null check (length(btrim(titel)) between 1 and 120),

  plan_datei_id  uuid references public.dateien(id) on delete set null,
  plan_seite     smallint not null default 1 check (plan_seite >= 1),
  plan_bild_pfad text,

  -- Der Abschluss. Alle vier gehören zusammen und entstehen gemeinsam.
  abgeschlossen_am    timestamptz,
  unterschrift_triga  text,
  unterschrift_gast   text,
  gast_name           text,
  protokoll_datei_id  uuid references public.dateien(id) on delete set null,

  erstellt_von   uuid not null references auth.users(id) on delete cascade,
  erstellt_am    timestamptz not null default now(),

  check (abgeschlossen_am is null
         or (unterschrift_triga is not null and unterschrift_gast is not null
             and gast_name is not null and length(btrim(gast_name)) > 0))
);

create index if not exists abnahmen_projekt_idx on public.abnahmen (projekt_id, erstellt_am desc);

/* Ein Mangel sitzt an einer Stelle des Plans. x und y stehen als Anteil
   der Planbreite und -höhe zwischen 0 und 1 und nicht in Pixeln: derselbe
   Plan ist auf dem Handy 350 Pixel breit und auf dem Bildschirm 900, und
   die Nadel soll trotzdem am selben Fleck sitzen. */
create table if not exists public.maengel (
  id           uuid primary key default gen_random_uuid(),
  abnahme_id   uuid not null references public.abnahmen(id) on delete cascade,
  nummer       smallint not null,
  x            numeric not null check (x >= 0 and x <= 1),
  y            numeric not null check (y >= 0 and y <= 1),
  beschrieb    text not null check (length(btrim(beschrieb)) between 1 and 500),
  firma_id     uuid references public.firmen(id) on delete set null,
  frist        date,
  foto_pfad    text,
  erledigt_am  timestamptz,
  erledigt_von uuid references auth.users(id) on delete set null,
  erstellt_von uuid not null references auth.users(id) on delete cascade,
  erstellt_am  timestamptz not null default now(),
  unique (abnahme_id, nummer)
);

create index if not exists maengel_abnahme_idx on public.maengel (abnahme_id, nummer);

/* Ist eine Abnahme unterschrieben, ist sie zu. Kein Mangel kommt dazu,
   keiner verschwindet, keiner ändert sich — das erzeugte PDF ist der
   Nachweis, und ein Nachweis, dessen Grundlage sich nachträglich
   verschiebt, ist keiner.
   Als Trigger und nicht als Policy: eine Policy, die eine Zeile nicht
   trifft, schweigt. Hier soll es eine Fehlermeldung geben, damit klar
   wird, warum nichts passiert. */
create or replace function public.abnahme_zu(p_abnahme uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.abnahmen
     where id = p_abnahme and abgeschlossen_am is not null
  );
$$;

/* Ein Trigger für zwei Tabellen. OLD und NEW sind dabei nicht immer beide
   da — beim Einfügen gibt es kein OLD, beim Löschen kein NEW —, deshalb
   die ausgeschriebenen Zweige statt eines coalesce über beide. */
create or replace function public.abnahme_gesperrt()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  welche uuid;
begin
  if tg_table_name = 'abnahmen' then
    if old.abgeschlossen_am is not null then
      if tg_op = 'DELETE' then
        raise exception 'Eine abgeschlossene Abnahme laesst sich nicht loeschen.';
      end if;
      raise exception 'Diese Abnahme ist abgeschlossen und laesst sich nicht mehr aendern.';
    end if;
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  -- maengel
  if tg_op = 'DELETE' then welche := old.abnahme_id; else welche := new.abnahme_id; end if;
  if public.abnahme_zu(welche) then
    raise exception 'Die Abnahme ist abgeschlossen, an ihren Maengeln laesst sich nichts mehr aendern.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists abnahme_gesperrt_trigger on public.abnahmen;
create trigger abnahme_gesperrt_trigger
  before update or delete on public.abnahmen
  for each row execute function public.abnahme_gesperrt();

drop trigger if exists maengel_gesperrt_trigger on public.maengel;
create trigger maengel_gesperrt_trigger
  before insert or update or delete on public.maengel
  for each row execute function public.abnahme_gesperrt();

/* --- Hilfsfunktionen für die Ablagen -------------------------------------- */

/* Der Beleg eines Spesenantrags. Beim Hochladen gibt es die Zeile noch
   nicht — die Kennung wird in der App gewürfelt, der Beleg liegt zuerst,
   der Antrag folgt. Eine fehlende Zeile zählt deshalb als erlaubt; scheitert
   das Anlegen, räumt die App die Datei gleich wieder weg. */
create or replace function public.antrag_darf_beleg(p_antrag uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select case
    when not public.ist_triga_person(auth.uid()) then false
    when not exists (select 1 from public.antraege where id = p_antrag) then true
    else exists (
      select 1 from public.antraege
       where id = p_antrag
         and (erstellt_von = auth.uid() or public.ist_berechtigt()))
  end;
$$;

revoke all on function public.abnahme_zu(uuid) from public;
revoke all on function public.antrag_darf_beleg(uuid) from public;
grant execute on function public.abnahme_zu(uuid) to authenticated;
grant execute on function public.antrag_darf_beleg(uuid) to authenticated;

/* --- RLS ------------------------------------------------------------------ */

alter table public.antraege enable row level security;
alter table public.abnahmen enable row level security;
alter table public.maengel  enable row level security;

/* Anträge: die eigenen sieht jede Person, alle sieht die erweiterte Stufe.
   Ein Spesenbetrag geht die Kollegin nichts an. */
create policy antraege_select on public.antraege for select to authenticated
  using (erstellt_von = auth.uid() or public.ist_berechtigt());

create policy antraege_insert on public.antraege for insert to authenticated
  with check (
    erstellt_von = auth.uid()
    and public.ist_triga_person(auth.uid())
    and status = 'eingereicht'
    and entschieden_am is null
  );

-- Entscheiden darf nur die erweiterte Stufe. Was dabei geändert werden
-- darf, hält der Trigger fest; die eigene Zeile zu genehmigen wäre
-- möglich, und das ist Absicht: die Geschäftsleitung reicht auch Spesen ein.
create policy antraege_update on public.antraege for update to authenticated
  using (public.ist_berechtigt())
  with check (public.ist_berechtigt());

-- Zurückziehen: nur die eigene Zeile, nur solange niemand entschieden hat.
create policy antraege_delete on public.antraege for delete to authenticated
  using (erstellt_von = auth.uid() and status = 'eingereicht');

/* Abnahmen und Mängel: das ganze Haus. Eine Bauabnahme ist Arbeit am
   Projekt, nicht Privatsache — wer vertritt, muss weiterführen können.
   Was nach dem Abschluss noch geht, entscheidet der Trigger. */
create policy abnahmen_select on public.abnahmen for select to authenticated
  using (public.ist_triga_person(auth.uid()));
create policy abnahmen_insert on public.abnahmen for insert to authenticated
  with check (erstellt_von = auth.uid() and public.ist_triga_person(auth.uid()));
create policy abnahmen_update on public.abnahmen for update to authenticated
  using (public.ist_triga_person(auth.uid()))
  with check (public.ist_triga_person(auth.uid()));
create policy abnahmen_delete on public.abnahmen for delete to authenticated
  using (public.ist_triga_person(auth.uid()));

create policy maengel_select on public.maengel for select to authenticated
  using (public.ist_triga_person(auth.uid()));
create policy maengel_insert on public.maengel for insert to authenticated
  with check (erstellt_von = auth.uid() and public.ist_triga_person(auth.uid()));
create policy maengel_update on public.maengel for update to authenticated
  using (public.ist_triga_person(auth.uid()))
  with check (public.ist_triga_person(auth.uid()));
-- Löschen nur, solange offen. Ein erledigter Mangel gehört ins Protokoll.
create policy maengel_delete on public.maengel for delete to authenticated
  using (public.ist_triga_person(auth.uid()) and erledigt_am is null);

/* --- Ablagen -------------------------------------------------------------- */

insert into storage.buckets (id, name, public)
values ('antrag-belege', 'antrag-belege', false),
       ('abnahme', 'abnahme', false)
on conflict (id) do nothing;

-- Ein Beleg liegt unter <antrag_id>/<zufall>.<endung>.
drop policy if exists belege_select on storage.objects;
create policy belege_select on storage.objects for select to authenticated
  using (bucket_id = 'antrag-belege'
         and public.antrag_darf_beleg(((storage.foldername(name))[1])::uuid));

drop policy if exists belege_insert on storage.objects;
create policy belege_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'antrag-belege'
              and public.antrag_darf_beleg(((storage.foldername(name))[1])::uuid));

drop policy if exists belege_delete on storage.objects;
create policy belege_delete on storage.objects for delete to authenticated
  using (bucket_id = 'antrag-belege'
         and public.antrag_darf_beleg(((storage.foldername(name))[1])::uuid));

/* Der gerenderte Plan und die Mängelfotos liegen unter <abnahme_id>/…
   Sehen und ablegen darf das ganze Haus, wie bei der Abnahme selbst.
   Entfernen nur, solange sie offen ist — sonst fehlte dem Protokoll
   nachträglich ein Foto, das darin abgebildet ist. */
drop policy if exists abnahme_select on storage.objects;
create policy abnahme_select on storage.objects for select to authenticated
  using (bucket_id = 'abnahme' and public.ist_triga_person(auth.uid()));

drop policy if exists abnahme_insert on storage.objects;
create policy abnahme_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'abnahme' and public.ist_triga_person(auth.uid()));

drop policy if exists abnahme_delete on storage.objects;
create policy abnahme_delete on storage.objects for delete to authenticated
  using (bucket_id = 'abnahme'
         and public.ist_triga_person(auth.uid())
         and not public.abnahme_zu(((storage.foldername(name))[1])::uuid));

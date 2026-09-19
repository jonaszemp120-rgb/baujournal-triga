-- Prüfspur für Bauabnahme und Sitzungsprotokoll.
--
-- Beides kann vor Gericht landen: eine Mängelrüge mit Frist, ein
-- Beschluss mit Teilnehmerliste. Dann zählt nicht nur, was am Schluss
-- dasteht, sondern auch, wer es wann eingetragen und wer es später
-- geändert hat. Bisher stand davon nichts irgendwo — erstellt_von und
-- erstellt_am sagen, wer angefangen hat, und sonst nichts.
--
-- Deshalb eine eigene Tabelle, die nur mitschreibt. Sie wird nicht aus
-- der App befüllt, sondern von Triggern: was an der Oberfläche vorbei
-- geändert wird, steht damit genauso drin wie das, was über einen
-- Bildschirm läuft. Und sie lässt sich nicht ändern — es gibt keine
-- Policy dafür, nicht für insert, nicht für update, nicht für delete.
-- Eine Prüfspur, die sich nachträglich zurechtlegen lässt, ist keine.

create table if not exists public.pruefspur (
  id          uuid primary key default gen_random_uuid(),

  -- 'abnahme' oder 'protokoll': wonach in der Regel gesucht wird.
  bereich     text not null check (bereich in ('abnahme', 'protokoll')),

  -- Der Vorgang, zu dem der Eintrag gehört: die Abnahme oder das
  -- Protokoll. Bewusst ohne Fremdschlüssel — verschwindet der Vorgang,
  -- bleibt die Spur stehen. Sonst wäre das Löschen der bequemste Weg,
  -- die eigenen Spuren zu verwischen.
  vorgang_id  uuid not null,
  projekt_id  uuid,

  tabelle     text not null,
  zeile_id    uuid not null,
  was         text not null check (was in ('erstellt', 'geaendert', 'geloescht')),

  -- Wofür die Zeile steht, im Klartext: "Mangel 3", "Traktandum 2".
  bezug       text,

  /* Bei einer Änderung: {"frist": {"vorher": "2026-03-01", "nachher":
     "2026-04-15"}}. Lange Werte stehen gekürzt drin — eine Unterschrift
     als Data-URL gehört nicht in ein Protokollbuch. */
  aenderungen jsonb,

  -- Wer. Der Name als Momentaufnahme daneben, denn ein Konto kann
  -- später weg sein, und dann stünde da nur noch eine Kennung.
  wer         uuid,
  wer_name    text,
  wann        timestamptz not null default now()
);

create index if not exists pruefspur_vorgang_idx on public.pruefspur (vorgang_id, wann);
create index if not exists pruefspur_projekt_idx on public.pruefspur (projekt_id, bereich, wann desc);

comment on table public.pruefspur is
  'Wer wann was an einer Bauabnahme oder einem Sitzungsprotokoll geaendert hat. Wird nur von Triggern geschrieben und laesst sich nicht aendern.';

/* --- Werkzeug --------------------------------------------------------------- */

/* Ein langer Text wird gekürzt. Unterschriften und Bilder stecken als
   Data-URL in der Zeile; ungekürzt wäre die Prüfspur nach zwei Abnahmen
   grösser als alles andere zusammen. */
create or replace function public.pruefspur_kurz(v jsonb)
returns jsonb
language sql
immutable
as $$
  select case
           when v is null then null
           when jsonb_typeof(v) = 'string' and length(v #>> '{}') > 200
             then to_jsonb(left(v #>> '{}', 200) || '…')
           else v
         end;
$$;

/* --- Der Mitschreiber ------------------------------------------------------- */

/* Ein Trigger für alle sechs Tabellen. Die beiden Angaben, die sich
   unterscheiden, kommen als Argumente:

     TG_ARGV[0] — 'abnahme' oder 'protokoll'
     TG_ARGV[1] — die Spalte, in der die Kennung des Vorgangs steht
                  ('id' bei der Abnahme und beim Protokoll selbst) */
create or replace function public.pruefspur_schreiben()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  bereich    text := tg_argv[0];
  spalte     text := tg_argv[1];
  zeile      jsonb;
  alt        jsonb;
  vorgang    uuid;
  projekt    uuid;
  aend       jsonb := '{}'::jsonb;
  schluessel text;
  tat        text;
  text_bezug text;
begin
  zeile := to_jsonb(coalesce(new, old));
  vorgang := (zeile ->> spalte)::uuid;

  if tg_op = 'INSERT' then tat := 'erstellt';
  elsif tg_op = 'DELETE' then tat := 'geloescht';
  else
    tat := 'geaendert';
    alt := to_jsonb(old);
    for schluessel in select jsonb_object_keys(zeile) loop
      if zeile -> schluessel is distinct from alt -> schluessel then
        aend := aend || jsonb_build_object(schluessel, jsonb_build_object(
          'vorher',  public.pruefspur_kurz(alt -> schluessel),
          'nachher', public.pruefspur_kurz(zeile -> schluessel)));
      end if;
    end loop;
    -- Ein Update, das nichts ändert, ist kein Vorgang.
    if aend = '{}'::jsonb then return coalesce(new, old); end if;
  end if;

  if bereich = 'abnahme' then
    select a.projekt_id into projekt from public.abnahmen a where a.id = vorgang;
  else
    select p.projekt_id into projekt from public.protokolle p where p.id = vorgang;
  end if;

  /* Damit die Spur ohne Verknüpfung lesbar ist: was die Zeile war,
     in denselben Worten wie am Bildschirm. */
  text_bezug := case tg_table_name
    when 'abnahmen'             then 'Abnahme ' || coalesce(zeile ->> 'titel', '')
    when 'abnahme_plaene'       then 'Plan ' || coalesce(zeile ->> 'titel', '')
    when 'maengel'              then 'Mangel ' || coalesce(zeile ->> 'nummer', '?')
                                     || ': ' || left(coalesce(zeile ->> 'beschrieb', ''), 80)
    when 'protokolle'           then 'Protokoll ' || coalesce(zeile ->> 'nummer', '?')
    when 'protokoll_traktanden' then 'Traktandum ' || coalesce(zeile ->> 'reihenfolge', '?')
                                     || ': ' || left(coalesce(zeile ->> 'titel', ''), 80)
    when 'protokoll_teilnehmer' then 'Teilnehmer ' || coalesce(zeile ->> 'name', '')
    else tg_table_name
  end;

  insert into public.pruefspur (bereich, vorgang_id, projekt_id, tabelle, zeile_id,
                                was, bezug, aenderungen, wer, wer_name, wann)
  values (bereich, vorgang, projekt, tg_table_name, (zeile ->> 'id')::uuid,
          tat, text_bezug,
          case when tat = 'geaendert' then aend else null end,
          auth.uid(),
          (select m.name from public.mitarbeiter m
            where m.user_id = auth.uid() and m.geloescht_am is null limit 1),
          now());

  return coalesce(new, old);
end $$;

comment on function public.pruefspur_schreiben() is
  'Schreibt jede Aenderung an Abnahme und Protokoll in public.pruefspur. Haengt als AFTER-Trigger an den sechs beteiligten Tabellen.';

/* --- Angehängt -------------------------------------------------------------- */

/* AFTER und nicht BEFORE: erst wenn die Änderung durch ist — an den
   Sperr-Triggern und der Policy vorbei —, ist sie ein Vorgang. Ein
   abgewiesener Versuch rollt mit zurück und hinterlässt nichts. */

drop trigger if exists pruefspur_abnahmen on public.abnahmen;
create trigger pruefspur_abnahmen
  after insert or update or delete on public.abnahmen
  for each row execute function public.pruefspur_schreiben('abnahme', 'id');

drop trigger if exists pruefspur_plaene on public.abnahme_plaene;
create trigger pruefspur_plaene
  after insert or update or delete on public.abnahme_plaene
  for each row execute function public.pruefspur_schreiben('abnahme', 'abnahme_id');

drop trigger if exists pruefspur_maengel on public.maengel;
create trigger pruefspur_maengel
  after insert or update or delete on public.maengel
  for each row execute function public.pruefspur_schreiben('abnahme', 'abnahme_id');

drop trigger if exists pruefspur_protokolle on public.protokolle;
create trigger pruefspur_protokolle
  after insert or update or delete on public.protokolle
  for each row execute function public.pruefspur_schreiben('protokoll', 'id');

drop trigger if exists pruefspur_teilnehmer on public.protokoll_teilnehmer;
create trigger pruefspur_teilnehmer
  after insert or update or delete on public.protokoll_teilnehmer
  for each row execute function public.pruefspur_schreiben('protokoll', 'protokoll_id');

drop trigger if exists pruefspur_traktanden on public.protokoll_traktanden;
create trigger pruefspur_traktanden
  after insert or update or delete on public.protokoll_traktanden
  for each row execute function public.pruefspur_schreiben('protokoll', 'protokoll_id');

/* --- Lesen, sonst nichts ---------------------------------------------------- */

alter table public.pruefspur enable row level security;

create policy pruefspur_select on public.pruefspur for select to authenticated
  using (public.ist_triga_person(auth.uid()));

/* Bewusst keine weiteren Policies. Geschrieben wird ausschliesslich von
   pruefspur_schreiben(), und das ist security definer — die Trigger
   kommen also durch, jede Hand von aussen nicht. */

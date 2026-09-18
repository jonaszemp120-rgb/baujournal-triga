-- Schritt 10: Pendenzen je Projekt, und die Rolle als reine Anzeige.

-- Offene Punkte, die ueber mehrere Tage stehen bleiben. Bewusst getrennt
-- vom Baujournal: das ist das Tagesprotokoll und haelt fest, was an
-- einem Tag war. Eine Pendenz haelt fest, was noch zu tun ist.
create table if not exists public.pendenzen (
  id           uuid primary key default gen_random_uuid(),
  projekt_id   uuid not null references public.projekte(id) on delete cascade,
  beschrieb    text not null,
  -- Optional, und bewusst ohne Zwang auf die Unternehmerliste: wird eine
  -- Firma spaeter vom Projekt entfernt, soll die Pendenz nicht mitgehen.
  firma_id     uuid references public.firmen(id) on delete set null,
  -- Der Zustand steckt in einem einzigen Feld: leer heisst offen,
  -- gesetzt heisst erledigt. Eine zweite Statusspalte daneben waere ein
  -- zweiter Ort fuer dieselbe Aussage, und die beiden laufen frueher
  -- oder spaeter auseinander. Dasselbe Muster wie geloescht_am in der
  -- ganzen App.
  erledigt_am  timestamptz,
  erledigt_von uuid references auth.users(id) on delete set null,
  erstellt_von uuid references auth.users(id) on delete set null,
  erstellt_am  timestamptz not null default now()
);

create index if not exists pendenzen_projekt_idx
  on public.pendenzen (projekt_id, erledigt_am nulls first, erstellt_am);

-- Eine Pendenz haengt an genau einem Projekt und ist in Sekunden neu
-- erfasst. Darum echtes Loeschen ohne Papierkorb, wie bei
-- Ansprechpersonen, Notizen und den Projektzuordnungen.
alter table public.pendenzen enable row level security;
create policy pendenzen_select on public.pendenzen for select to authenticated using (true);
create policy pendenzen_insert on public.pendenzen for insert to authenticated with check (auth.uid() is not null);
create policy pendenzen_update on public.pendenzen for update to authenticated using (true) with check (true);
create policy pendenzen_delete on public.pendenzen for delete to authenticated using (true);

-- Die Rolle. Zwei Stufen, Default die untere.
--
-- Die Spalte heisst berechtigung und nicht rolle: rolle gibt es an
-- dieser Tabelle laengst und meint die Funktion im Betrieb
-- ("Bauleiter", "Administration"). Das hier ist etwas anderes.
--
-- In diesem Schritt haengt bewusst nichts daran: keine Policy fragt sie
-- ab, keine Ansicht blendet etwas aus. Sie wird nur angezeigt und
-- vorerst von Hand im Supabase-Dashboard gepflegt.
alter table public.mitarbeiter add column if not exists berechtigung text not null
  default 'mitarbeitend' check (berechtigung in ('mitarbeitend', 'geschaeftsleitung'));

comment on column public.mitarbeiter.berechtigung is
  'Zugriffsstufe, mitarbeitend oder geschaeftsleitung. Stand Schritt 10 reine Anzeige, ohne Wirkung auf Sichtbarkeit oder Rechte. Nicht verwechseln mit rolle, das ist die Funktion im Betrieb.';

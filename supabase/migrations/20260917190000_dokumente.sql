-- Bereich Dokumente: frei benannte Ordner, darin PDF-Dateien.
-- Die Ordner sind bewusst flach, keine Verschachtelung, so wie in der
-- Referenz. Eine Ebene reicht und man verliert sich nicht in Baeumen.

create table if not exists public.ordner (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  geloescht_am  timestamptz,
  geloescht_von uuid references auth.users(id) on delete set null,
  erstellt_von  uuid references auth.users(id) on delete set null,
  erstellt_am   timestamptz not null default now()
);

create table if not exists public.dateien (
  id              uuid primary key default gen_random_uuid(),
  ordner_id       uuid not null references public.ordner(id),
  name            text not null,   -- der urspruengliche Dateiname
  pfad            text not null,   -- der Ablageort im Bucket
  groesse         bigint,
  typ             text,
  hochgeladen_von uuid references auth.users(id) on delete set null,
  hochgeladen_am  timestamptz not null default now(),
  geloescht_am    timestamptz,
  geloescht_von   uuid references auth.users(id) on delete set null
);

create index if not exists ordner_aktiv_idx
  on public.ordner (name) where geloescht_am is null;
create index if not exists dateien_ordner_idx
  on public.dateien (ordner_id, hochgeladen_am desc) where geloescht_am is null;

drop trigger if exists ordner_loeschspur on public.ordner;
create trigger ordner_loeschspur
  before update on public.ordner
  for each row execute function public.setze_loeschspur();

drop trigger if exists dateien_loeschspur on public.dateien;
create trigger dateien_loeschspur
  before update on public.dateien
  for each row execute function public.setze_loeschspur();

alter table public.ordner  enable row level security;
alter table public.dateien enable row level security;

create policy ordner_select on public.ordner
  for select to authenticated using (true);
create policy ordner_insert on public.ordner
  for insert to authenticated with check (auth.uid() is not null);
create policy ordner_update on public.ordner
  for update to authenticated using (true) with check (true);

create policy dateien_select on public.dateien
  for select to authenticated using (true);
create policy dateien_insert on public.dateien
  for insert to authenticated with check (auth.uid() is not null);
create policy dateien_update on public.dateien
  for update to authenticated using (true) with check (true);

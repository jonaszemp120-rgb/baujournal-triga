-- Eintraege sollen aus den Listen verschwinden koennen, ohne je wirklich
-- geloescht zu werden. Es gibt weiterhin keine delete-Policy auf
-- eintraege, das bleibt so. Stattdessen zwei Felder und zwei Funktionen.

alter table public.eintraege
  add column if not exists geloescht_am  timestamptz,
  add column if not exists geloescht_von uuid references auth.users(id) on delete set null;

-- Nur die nicht geloeschten stehen in den Listen, dafuer ein Teilindex.
create index if not exists eintraege_aktiv_idx
  on public.eintraege (projekt_id, datum desc, erstellt_am desc)
  where geloescht_am is null;

create or replace function public.loesche_eintrag(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.eintraege
     set geloescht_am = now(), geloescht_von = auth.uid()
   where id = p_id and geloescht_am is null;

  if not found then
    raise exception 'Eintrag % nicht gefunden oder schon im Papierkorb', p_id;
  end if;
end;
$$;

create or replace function public.stelle_eintrag_wieder_her(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.eintraege
     set geloescht_am = null, geloescht_von = null
   where id = p_id and geloescht_am is not null;

  if not found then
    raise exception 'Eintrag % nicht gefunden oder nicht im Papierkorb', p_id;
  end if;
end;
$$;

revoke execute on function public.loesche_eintrag(uuid) from public, anon;
grant  execute on function public.loesche_eintrag(uuid) to authenticated;
revoke execute on function public.stelle_eintrag_wieder_her(uuid) from public, anon;
grant  execute on function public.stelle_eintrag_wieder_her(uuid) to authenticated;

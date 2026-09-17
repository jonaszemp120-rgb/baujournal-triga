-- Gebaeude und Bauteile je Projekt, und pro Eintrag die Auswahl, welche
-- davon der Rundgang betrifft. Beides optional, Projekte mit einem
-- einzigen Baukoerper lassen es einfach leer.

alter table public.projekte
  add column if not exists gebaeude jsonb not null default '[]'::jsonb;

alter table public.eintraege
  add column if not exists betrifft_gebaeude jsonb;

-- Die Korrekturfunktion muss das neue Feld mitziehen koennen, sonst
-- waere eine falsche Gebaeudeangabe als einziges Feld nicht korrigierbar.
create or replace function public.korrigiere_eintrag(
  p_id  uuid,
  p_neu jsonb,
  p_log jsonb
) returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_log is null or jsonb_array_length(p_log) = 0 then
    return;
  end if;

  insert into public.eintraege_korrekturen
    (eintrag_id, geaendert_von, feld, alter_wert, neuer_wert)
  select p_id, auth.uid(), e->>'feld', e->>'alter_wert', e->>'neuer_wert'
  from jsonb_array_elements(p_log) e;

  update public.eintraege set
    datum             = coalesce((p_neu->>'datum')::date, datum),
    wetter            = case when p_neu ? 'wetter'         then p_neu->>'wetter'         else wetter end,
    temperatur        = case when p_neu ? 'temperatur'     then p_neu->>'temperatur'     else temperatur end,
    kontrolle         = coalesce(p_neu->'kontrolle', kontrolle),
    betrifft_gebaeude = case when p_neu ? 'betrifft_gebaeude' then p_neu->'betrifft_gebaeude' else betrifft_gebaeude end,
    firmen            = case when p_neu ? 'firmen'         then p_neu->>'firmen'         else firmen end,
    fortschritt       = case when p_neu ? 'fortschritt'    then p_neu->>'fortschritt'    else fortschritt end,
    feststellungen    = case when p_neu ? 'feststellungen' then p_neu->>'feststellungen' else feststellungen end,
    anweisungen       = case when p_neu ? 'anweisungen'    then p_neu->>'anweisungen'    else anweisungen end,
    fotos_hinweis     = coalesce((p_neu->>'fotos_hinweis')::boolean, fotos_hinweis)
  where id = p_id;

  if not found then
    raise exception 'Eintrag % nicht gefunden oder nicht aenderbar', p_id;
  end if;
end;
$$;

revoke execute on function public.korrigiere_eintrag(uuid, jsonb, jsonb) from public, anon;
grant  execute on function public.korrigiere_eintrag(uuid, jsonb, jsonb) to authenticated;

-- Der gemessene Wert bleibt am Eintrag stehen.
--
-- Bisher hielt ein Eintrag vom Wetter nur die beiden Grobstufen fest:
-- «Sonnig» und «10–20°C». Damit ging genau das verloren, was die
-- Live-Abfrage ausmacht — die Gradzahl selbst, der Zeitpunkt der Messung
-- und die Tatsache, dass da überhaupt gemessen und nicht getippt wurde.
-- Nach dem Speichern sah ein abgerufener Eintrag aus wie jeder andere.
--
-- Für ein Journal, das im Streitfall als Beweismittel dient, ist das der
-- Unterschied zwischen «der Bauleiter hat sonnig angetippt» und «um 11:25
-- wurden an diesem Ort 17.2 Grad gemessen».

alter table public.eintraege
  add column if not exists wetter_grad numeric(4,1),
  add column if not exists wetter_gemessen_am timestamptz;

comment on column public.eintraege.wetter_grad is
  'Die gemessene Temperatur der Live-Abfrage, auf ein Zehntelgrad. Null, wenn von Hand gewaehlt wurde.';
comment on column public.eintraege.wetter_gemessen_am is
  'Zeitpunkt der Messung. Steht hier etwas, stammen wetter und temperatur aus der Abfrage und nicht von Hand.';

/* Beides gehört zusammen: eine Gradzahl ohne Zeitpunkt sagt nicht, wann
   sie galt, und ein Zeitpunkt ohne Gradzahl ist keine Messung. Und ohne
   Wetterangabe gibt es nichts zu messen. */
alter table public.eintraege drop constraint if exists eintraege_wetter_messung;
alter table public.eintraege add constraint eintraege_wetter_messung check (
  (wetter_grad is null and wetter_gemessen_am is null)
  or (wetter_grad is not null and wetter_gemessen_am is not null
      and (wetter is not null or temperatur is not null))
);

/* Bestehende Einträge bleiben, wie sie sind: beide Spalten null, also
   keine Messung. Nichts wird rückwirkend behauptet, was niemand gemessen
   hat. */

/* --- Korrektur --------------------------------------------------------- */

/* korrigiere_eintrag() führt eine Erlaubnisliste von Spalten. Die zwei
   neuen stehen bewusst nicht darin — von Hand nachtragen soll niemand
   können, was als Messung gilt.
   Umgekehrt muss die Messung fallen, sobald jemand die Chips korrigiert:
   sonst stünde «um 11:25 gemessen: Sonnig» an einem Eintrag, bei dem
   inzwischen Regen angetippt ist. Wer korrigiert, ersetzt die Messung
   durch seine eigene Einschätzung, und dann ist es keine mehr. Im
   Korrekturprotokoll steht die Änderung ohnehin. */
create or replace function public.korrigiere_eintrag(p_id uuid, p_neu jsonb, p_log jsonb)
returns void
language plpgsql
set search_path to 'public'
as $function$
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
    fotos_hinweis     = coalesce((p_neu->>'fotos_hinweis')::boolean, fotos_hinweis),

    -- Korrigierte Chips heben die Messung auf, siehe oben.
    wetter_grad        = case when p_neu ? 'wetter' or p_neu ? 'temperatur' then null else wetter_grad end,
    wetter_gemessen_am = case when p_neu ? 'wetter' or p_neu ? 'temperatur' then null else wetter_gemessen_am end
  where id = p_id;

  if not found then
    raise exception 'Eintrag % nicht gefunden oder nicht aenderbar', p_id;
  end if;
end;
$function$;

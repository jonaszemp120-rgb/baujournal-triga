-- Welcher Dienst die Angabe geliefert hat.
--
-- Bisher stand die Herkunft nur in der Formulierung am Bildschirm, und
-- dort hiess sie «gemessen». Beides ist zu knapp: «gemessen» klingt, als
-- hätte jemand ein Thermometer abgelesen, und der Name des Dienstes
-- gehört nicht in einen Anzeigetext, sondern in eine Spalte. Kommt
-- später ein zweiter Dienst dazu oder wird gewechselt, muss an jedem
-- einzelnen Eintrag nachvollziehbar bleiben, woher seine Angabe kam.

alter table public.eintraege
  add column if not exists wetter_quelle text;

comment on column public.eintraege.wetter_quelle is
  'Name des Wetterdienstes, der wetter_grad geliefert hat, z. B. Open-Meteo. Null, wenn von Hand gewaehlt wurde.';

/* Der Bestand: bis hierher gab es genau einen Dienst, also stammt jede
   vorhandene Abfrage von ihm. Das ist keine Annahme, sondern die
   Geschichte dieser App — vor dieser Migration konnte gar nichts anderes
   eingetragen werden. */
update public.eintraege
   set wetter_quelle = 'Open-Meteo'
 where wetter_gemessen_am is not null and wetter_quelle is null;

/* Von hier an gehören alle drei zusammen. Eine Gradzahl ohne Zeitpunkt
   sagt nicht, wann sie galt; eine ohne Quelle nicht, wer sie behauptet.
   Und ohne Wetterangabe daneben gibt es nichts abzufragen. */
alter table public.eintraege drop constraint if exists eintraege_wetter_messung;
alter table public.eintraege add constraint eintraege_wetter_messung check (
  (wetter_grad is null and wetter_gemessen_am is null and wetter_quelle is null)
  or (wetter_grad is not null and wetter_gemessen_am is not null
      and wetter_quelle is not null and length(btrim(wetter_quelle)) between 1 and 60
      and (wetter is not null or temperatur is not null))
);

/* Die Spalte wetter_gemessen_am behält ihren Namen. Sie steht seit dem
   ersten Tag so in der Tabelle, und ein Eintrag, der in einer
   Offline-Warteschlange auf einem Handy liegt, trägt den alten Namen
   bereits bei sich — eine Umbenennung liesse ihn beim Nachtragen
   auflaufen. Gemeint ist der Zeitpunkt der Abfrage. */

/* --- Korrektur --------------------------------------------------------- */

/* Wie zuvor: korrigierte Chips heben die Abfrage auf, und nachtragen
   lässt sich keine — die drei Spalten stehen nicht in der
   Erlaubnisliste. Neu fällt wetter_quelle mit den beiden anderen. */
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

    wetter_grad        = case when p_neu ? 'wetter' or p_neu ? 'temperatur' then null else wetter_grad end,
    wetter_gemessen_am = case when p_neu ? 'wetter' or p_neu ? 'temperatur' then null else wetter_gemessen_am end,
    wetter_quelle      = case when p_neu ? 'wetter' or p_neu ? 'temperatur' then null else wetter_quelle end
  where id = p_id;

  if not found then
    raise exception 'Eintrag % nicht gefunden oder nicht aenderbar', p_id;
  end if;
end;
$function$;

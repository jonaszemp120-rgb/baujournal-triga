-- Die Rohmesswerte der Abfrage bleiben am Eintrag stehen.
--
-- Bisher hielt ein Eintrag von der Abfrage die Gradzahl, den Zeitpunkt
-- und den Namen des Dienstes. Die Wetterlage dagegen stand nur noch als
-- Chip da: aus einem Gewitter mit Hagel war «Sturm/Wind» geworden, und
-- der Weg zurück war zu. Wer Jahre später wissen will, was an jenem Tag
-- wirklich gemeldet wurde, findet die Zuordnung, nicht ihren Anlass.
--
-- Deshalb kommt alles mit, was der Dienst geliefert hat. Die Zuordnung
-- auf die sieben Chips wird damit zu dem, was sie sein soll: eine Frage
-- der Anzeige, jederzeit nachrechenbar und bei Bedarf anders zu treffen.
--
-- Warum jsonb und nicht eine Spalte je Wert: die Dienste liefern
-- Verschiedenes. MeteoSchweiz misst Böe, Niederschlag, Sonnenschein und
-- Feuchte, ein Modelldienst liefert stattdessen einen WMO-Schlüssel.
-- Welche Form hier steht, sagt wetter_quelle daneben. Feste Spalten
-- wären beim zweiten Dienst schon wieder falsch.

alter table public.eintraege
  add column if not exists wetter_rohwerte jsonb;

comment on column public.eintraege.wetter_rohwerte is
  'Was der Wetterdienst unveraendert geliefert hat, samt Station und Abstand. Die Form haengt von wetter_quelle ab. Null, wenn von Hand gewaehlt wurde.';

/* Bestehende Einträge bekommen nichts nachgetragen: was damals an
   Rohwerten kam, steht nirgends mehr, und Erfundenes gehört nicht in ein
   Journal. Sie behalten Gradzahl, Zeitpunkt und Quelle und zeigen
   weiterhin ihre Zeile. */

/* Die Prüfregel bleibt, wie sie war, und nimmt die neue Spalte nur mit:
   Rohwerte ohne Abfrage wären Werte ohne Herkunft. Umgekehrt darf eine
   Abfrage ohne Rohwerte dastehen — die Einträge von vor dieser
   Migration sind genau das. */
alter table public.eintraege drop constraint if exists eintraege_wetter_messung;
alter table public.eintraege add constraint eintraege_wetter_messung check (
  (wetter_grad is null and wetter_gemessen_am is null and wetter_quelle is null
   and wetter_rohwerte is null)
  or (wetter_grad is not null and wetter_gemessen_am is not null
      and wetter_quelle is not null and length(btrim(wetter_quelle)) between 1 and 60
      and (wetter is not null or temperatur is not null))
);

/* --- Korrektur --------------------------------------------------------- */

/* Unverändert im Grundsatz: korrigierte Chips heben die Abfrage auf, und
   nachtragen lässt sich keine. Neu fallen die Rohwerte mit — sie
   beschrieben sonst eine Lage, die niemand mehr behauptet. */
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
    wetter_quelle      = case when p_neu ? 'wetter' or p_neu ? 'temperatur' then null else wetter_quelle end,
    wetter_rohwerte    = case when p_neu ? 'wetter' or p_neu ? 'temperatur' then null else wetter_rohwerte end
  where id = p_id;

  if not found then
    raise exception 'Eintrag % nicht gefunden oder nicht aenderbar', p_id;
  end if;
end;
$function$;

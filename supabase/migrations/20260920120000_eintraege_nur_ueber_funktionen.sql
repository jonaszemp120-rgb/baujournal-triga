-- Ein Eintrag lässt sich nur noch über die drei Funktionen ändern.
--
-- Gefunden beim Beweis zur Wetterspalte: die UPDATE-Policy auf eintraege
-- stand auf `true` und das Spaltenrecht lag bei authenticated. Damit
-- konnte jedes angemeldete Konto mit einem direkten Aufruf an PostgREST
-- jede Spalte jedes Eintrags umschreiben — an der Erlaubnisliste von
-- korrigiere_eintrag() vorbei, am Korrekturprotokoll vorbei, und an dem
-- Schutz vorbei, der verhindert, dass eine Wetterabfrage von Hand
-- nachgetragen wird.
--
-- Für ein Journal, das im Streitfall als Beweismittel dient, ist das der
-- wunde Punkt schlechthin: niemand könnte hinterher sagen, ob eine Zeile
-- so geschrieben oder später still geändert wurde.
--
-- Die App merkt davon nichts. Sie schreibt seit jeher ausschliesslich
-- über loesche_eintrag(), stelle_eintrag_wieder_her() und
-- korrigiere_eintrag(); ein direktes update steht in keiner Datei.
--
-- Warum es mit einem revoke allein nicht getan war: die drei Funktionen
-- liefen als `security invoker`, also mit den Rechten der aufrufenden
-- Person — sie lebten von genau dem Recht, das hier weggenommen wird.
-- Sie werden deshalb zuerst auf `security definer` gestellt und bringen
-- ihre Prüfung selbst mit.

/* --- Wer überhaupt etwas ändern darf ------------------------------------ */

/* Dieselbe Regel wie bisher in der Praxis, nur jetzt wirklich geprüft:
   wer einen Eintrag im Bereich Mitarbeiter hat, darf. Nicht enger, denn
   auf einer Baustelle korrigiert auch mal der Stellvertreter, und wer in
   den Ferien ist, soll keine Korrektur blockieren. Nicht weiter, denn ein
   Konto ohne Adressbuchzeile gehört nicht zum Team.

   Die Prüfung steht in jeder der drei Funktionen und nicht in einer
   gemeinsamen Hülle: eine Funktion, die mit den Rechten des Eigentümers
   läuft, muss an ihrer eigenen ersten Zeile sagen, für wen sie das tut. */
create or replace function public.darf_eintrag_aendern()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select auth.uid() is not null and public.ist_triga_person(auth.uid());
$function$;

comment on function public.darf_eintrag_aendern() is
  'Wer im Adressbuch steht, darf Eintraege korrigieren, loeschen und wiederherstellen. Geprueft in den drei Funktionen, die als security definer laufen.';

/* --- Korrigieren --------------------------------------------------------- */

/* Unverändert in allem, was sie tut: dieselbe Erlaubnisliste von Spalten,
   dasselbe Korrekturprotokoll, dieselbe Regel, dass eine Korrektur am
   Wetter die vier Abfragespalten löscht. Neu sind zwei Zeilen am Anfang. */
create or replace function public.korrigiere_eintrag(p_id uuid, p_neu jsonb, p_log jsonb)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if not public.darf_eintrag_aendern() then
    raise exception 'Eintraege aendert nur, wer im Adressbuch steht.' using errcode = '42501';
  end if;

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

/* --- In den Papierkorb und zurück ---------------------------------------- */

/* Beide unverändert bis auf die Prüfung. Ein echtes delete gibt es hier
   nach wie vor nicht und soll es nicht geben: ein Eintrag wandert in den
   Papierkorb und kommt von dort zurück. */
create or replace function public.loesche_eintrag(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if not public.darf_eintrag_aendern() then
    raise exception 'Eintraege loescht nur, wer im Adressbuch steht.' using errcode = '42501';
  end if;

  update public.eintraege
     set geloescht_am = now(), geloescht_von = auth.uid()
   where id = p_id and geloescht_am is null;

  if not found then
    raise exception 'Eintrag % nicht gefunden oder schon im Papierkorb', p_id;
  end if;
end;
$function$;

create or replace function public.stelle_eintrag_wieder_her(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if not public.darf_eintrag_aendern() then
    raise exception 'Eintraege stellt nur wieder her, wer im Adressbuch steht.' using errcode = '42501';
  end if;

  update public.eintraege
     set geloescht_am = null, geloescht_von = null
   where id = p_id and geloescht_am is not null;

  if not found then
    raise exception 'Eintrag % nicht gefunden oder nicht im Papierkorb', p_id;
  end if;
end;
$function$;

/* --- Und jetzt die Tür zu ------------------------------------------------- */

/* Zwei Riegel, weil einer allein jeweils zu wenig wäre. Das Spaltenrecht
   nimmt der Rolle die Möglichkeit, überhaupt ein update zu formulieren;
   die Policy nimmt ihr die Zeilen. Wer eines von beiden später wieder
   öffnet, stösst noch auf das andere.

   Die Funktionen oben laufen als Eigentümer und sind davon nicht
   betroffen — genau dafür wurden sie umgestellt. */
revoke update on public.eintraege from authenticated, anon;

drop policy if exists eintraege_update on public.eintraege;

/* Die Policy bleibt als ausdrückliches Nein stehen statt zu verschwinden.
   Eine Tabelle ohne UPDATE-Policy weist zwar ebenfalls alles ab, aber
   stumm — und wer hier später nachsieht, soll die Absicht lesen können
   und nicht raten müssen, ob jemand die Policy vergessen hat.

   Genau dasselbe Muster wie beim Löschen: auch dort steht keine
   Delete-Policy, und auch das ist Absicht. */
create policy eintraege_update on public.eintraege
  for update to authenticated
  using (false) with check (false);

comment on policy eintraege_update on public.eintraege is
  'Absichtlich false: geaendert wird ausschliesslich ueber korrigiere_eintrag(), loesche_eintrag() und stelle_eintrag_wieder_her(). Nur so entsteht zu jeder Aenderung eine Zeile im Korrekturprotokoll.';

/* Ausführen dürfen die drei weiterhin nur angemeldete Konten. Wer darin
   etwas darf, entscheidet die Prüfung in der Funktion. */
revoke all on function public.korrigiere_eintrag(uuid, jsonb, jsonb) from public, anon;
revoke all on function public.loesche_eintrag(uuid) from public, anon;
revoke all on function public.stelle_eintrag_wieder_her(uuid) from public, anon;
revoke all on function public.darf_eintrag_aendern() from public, anon;

grant execute on function public.korrigiere_eintrag(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.loesche_eintrag(uuid) to authenticated;
grant execute on function public.stelle_eintrag_wieder_her(uuid) to authenticated;
grant execute on function public.darf_eintrag_aendern() to authenticated;

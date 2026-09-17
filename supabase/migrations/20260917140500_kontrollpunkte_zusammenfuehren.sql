-- Die feste Basis-Checkliste und die projektspezifischen Zusatzpunkte
-- werden zu einer einzigen, vollstaendig editierbaren Liste je Projekt.
-- Die zehn bisherigen Basispunkte sind ab jetzt nur noch die Startvorlage
-- fuer ein neues Projekt, kein unveraenderlicher Sockel mehr.

alter table public.projekte
  add column if not exists kontrollpunkte jsonb not null default
    '["Gerüste (Zustand, Verankerung)",
      "Bauzaun / Absperrungen intakt",
      "Baustellensignalisation vorhanden",
      "Ordnung / Sauberkeit Baustelle",
      "Fluchtwege frei",
      "PSA getragen (Helm, Schuhe, Weste)",
      "Materiallagerung korrekt",
      "Bauschild vorhanden",
      "Entsorgung / Mulden geordnet",
      "Lärmschutz / Ruhezeiten eingehalten"]'::jsonb;

-- Bestand zusammenfuehren: erst die zehn Basispunkte, dann die
-- bisherigen Zusatzpunkte in ihrer Reihenfolge.
update public.projekte
   set kontrollpunkte = (
     select jsonb_agg(w)
     from (
       select w from jsonb_array_elements(
         '["Gerüste (Zustand, Verankerung)",
           "Bauzaun / Absperrungen intakt",
           "Baustellensignalisation vorhanden",
           "Ordnung / Sauberkeit Baustelle",
           "Fluchtwege frei",
           "PSA getragen (Helm, Schuhe, Weste)",
           "Materiallagerung korrekt",
           "Bauschild vorhanden",
           "Entsorgung / Mulden geordnet",
           "Lärmschutz / Ruhezeiten eingehalten"]'::jsonb) w
       union all
       select w from jsonb_array_elements(coalesce(zusatz_kontrollpunkte, '[]'::jsonb)) w
     ) s
   );

-- Vor dem Wegnehmen der alten Spalte pruefen, dass wirklich jeder
-- bisherige Zusatzpunkt in der neuen Liste steht. Stimmt etwas nicht,
-- bricht die Transaktion ab und die alte Spalte bleibt erhalten.
do $$
declare fehlend int;
begin
  select count(*) into fehlend
  from public.projekte p,
       lateral jsonb_array_elements(coalesce(p.zusatz_kontrollpunkte, '[]'::jsonb)) z
  where not (p.kontrollpunkte @> jsonb_build_array(z));

  if fehlend > 0 then
    raise exception 'Zusammenfuehrung unvollstaendig: % Zusatzpunkte fehlen', fehlend;
  end if;
end $$;

alter table public.projekte drop column if exists zusatz_kontrollpunkte;

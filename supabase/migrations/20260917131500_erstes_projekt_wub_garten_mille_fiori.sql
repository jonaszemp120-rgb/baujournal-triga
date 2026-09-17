-- Das erste echte Projekt. Die User-ID wird ueber die E-Mail
-- nachgeschlagen, damit hier keine generierte ID fest verdrahtet ist.
-- Der Insert laeuft nur, wenn das Projekt noch nicht existiert.

insert into public.projekte
  (name, standort, bauherrschaft, parzelle, projekt_nr,
   zusatz_kontrollpunkte, gebaeude, erstellt_von)
select
  'WUB Garten Mille Fiori, Sarnen',
  'Museumstrasse / Gartenstrasse, 6060 Sarnen',
  'StImmobilia GmbH',
  '3188',
  '25004',
  '["Rissaufnahme Nachbarbauten prüfen"]'::jsonb,
  '["Magnolia", "Lilly", "Flora", "Viola", "Dahlia"]'::jsonb,
  (select id from auth.users where email = 'jonas.zemp@triga.ch')
where not exists (
  select 1 from public.projekte where name = 'WUB Garten Mille Fiori, Sarnen'
);

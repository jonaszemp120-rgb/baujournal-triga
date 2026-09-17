-- Das Team, Stand 17.09.2026. erstellt_von bleibt leer: die Eintraege
-- kommen aus einer Liste, nicht aus der App. Jeder Name wird nur
-- angelegt, wenn er noch nicht existiert, die Migration laesst sich
-- damit gefahrlos wiederholen.

insert into public.mitarbeiter (name, rolle, telefon, email)
select v.name, v.rolle, v.telefon, v.email
from (values
  ('Adrian Zemp',      'Geschäftsleitung, Inhaber',                    '079 763 62 30', 'adrian.zemp@triga.ch'),
  ('Marco Delea',      'Bau-/Projektleitung, Inhaber, Mitglied der GL','079 652 75 70', 'marco.delea@triga.ch'),
  ('David Schmid',     'Bau-/Projektleitung, Inhaber, Mitglied der GL','079 642 07 19', 'david.schmid@triga.ch'),
  ('Thomas Zürcher',   'Bau-/Projektleitung, Mitglied der GL',         '079 957 58 44', 'thomas.zuercher@triga.ch'),
  ('Bruno Wiederkehr', 'Bau-/Projektleitung',                          '079 408 54 77', 'bruno.wiederkehr@triga.ch'),
  ('Silvia Weber',     'Administration',                               '079 548 63 01', 'silvia.weber@triga.ch'),
  ('Damian Stocker',   'Bauleitung',                                   '079 558 85 83', 'damian.stocker@triga.ch'),
  ('Felix Zemp',       'Bauleitung',                                   '079 877 45 60', 'felix.zemp@triga.ch'),
  ('Jonas Iten',       'Bauleitung',                                   '079 933 75 40', 'jonas.iten@triga.ch'),
  ('Jonas Zemp',       'Bauleitung',                                   '077 500 80 96', 'jonas.zemp@triga.ch')
) as v(name, rolle, telefon, email)
where not exists (
  select 1 from public.mitarbeiter m where m.name = v.name
);

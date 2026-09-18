-- Ruecknahme aus derselben Sitzung: die Spalte adresse war ein Fehler.
--
-- Der Prompt verlangt fuer Schritt 9 ein Feld "Adresse". Das gibt es
-- aber laengst: projekte.standort ist im Baujournal-Formular seit jeher
-- mit "Standort / Adresse" beschriftet, Platzhalter "Strasse, PLZ Ort",
-- und bei Mille Fiori steht dort genau
-- "Museumstrasse / Gartenstrasse, 6060 Sarnen" -- also die Adresse, die
-- auch die Design-Referenz auf der Projektkarte zeigt.
--
-- Zwei Spalten fuer dieselbe Angabe waeren zwei Orte zum Pflegen und
-- damit zwei Wahrheiten, sobald jemand nur eine davon nachfuehrt. Die
-- neue Spalte faellt darum wieder weg, die Oberflaeche beschriftet
-- standort als "Adresse". Sie war nie befuellt, es geht nichts verloren.
alter table public.projekte drop column if exists adresse;

comment on column public.projekte.standort is
  'Adresse der Baustelle, Strasse und PLZ Ort. Heisst historisch standort, weil das Baujournal sie als Untertitel in seiner Kopfzeile fuehrt.';

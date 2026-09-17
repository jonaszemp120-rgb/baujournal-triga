# Startbestand des Firmenpools

Die drei Dateien stammen aus der TRIGA-Submittentenliste
(`25004_Submittentenliste_260324.docx`, Stand 24.03.2026) und sind die
Quelle für die Migration
`supabase/migrations/20260917200000_firmenpool_startbestand.sql`.

| Datei | Inhalt |
|---|---|
| `bkp_kategorien.csv` | 41 BKP-Codes mit Bezeichnung, Startbestand für `bkp_liste`. |
| `submittenten_firmen_unique.csv` | 224 Firmen, eine Zeile je Firma, `bkp_codes` als Semikolon-Liste. Startbestand für `firmen`. |
| `submittenten_detail.csv` | Dieselben Daten, aber eine Zeile je BKP-Firma-Zuordnung (384 Zeilen). Nicht eingelesen, liegt als Nachweis dabei. |

Eingelesen wurde `submittenten_firmen_unique.csv`. Der BKP-Code ist das
erste Wort vor dem Leerzeichen jedes Semikolon-Teils, der Rest ist die
Bezeichnung und steht schon in `bkp_kategorien.csv`.

Die Liste ist ein einmaliger Startbestand, kein laufender Abgleich. Ab
jetzt wird der Firmenpool in der App gepflegt. Wer später eine weitere
aufgeräumte Liste dazunehmen will, nimmt den Import mit Spaltenzuordnung
im Bereich Firmenpool, nicht diesen Ordner.

Sechs Einträge sehen nach Dubletten oder Filialen aus, etwa
`L.Fugenbau GmbH` und `L. Fugenbau GmbH` oder die beiden AGI-Standorte.
Sie wurden bewusst nicht zusammengelegt: das ist eine inhaltliche
Entscheidung und gehört ins Team, nicht in eine Migration.

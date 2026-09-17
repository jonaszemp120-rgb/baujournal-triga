# Baujournal · TRIGA Baumanagement AG

Bautagebuch für die Baustellen der TRIGA Baumanagement AG. Läuft im Browser,
lässt sich auf dem Handy zum Homescreen hinzufügen und funktioniert auch ohne
Empfang, etwa in der Tiefgarage oder im Rohbau.

Kein Build-Schritt, kein Framework. Reines HTML, CSS und JavaScript, das Vercel
direkt als statische Seiten ausliefert. Wer am Code etwas ändert, öffnet die
Datei, speichert, fertig.

## Screens

| Datei | Zweck |
|---|---|
| `index.html` | Anmeldung. Kein Selbstregistrieren, Konten legt die Geschäftsleitung im Supabase-Dashboard an. |
| `projekte.html` | Übersicht aller Baustellen, mit Suche und Archivfilter. |
| `projekt-start.html` | Startseite einer Baustelle: neues Baujournal, abgeschlossene Einträge, Papierkorb. |
| `projekt.html` | Projekt anlegen und bearbeiten. Ohne `?id=` neu, mit `?id=` bestehend. |
| `journal.html` | Das Formular für den Rundgang. |
| `eintrag.html` | Ein einzelner Eintrag: lesen, korrigieren, exportieren, löschen. |
| `papierkorb.html` | Die gelöschten Einträge eines Projekts, mit Wiederherstellen. |
| `start.html` | Die Startseite nach dem Login: Auswahl zwischen den vier Bereichen. |
| `mitarbeiter.html` | Das Adressbuch des Teams. |
| `firmenpool.html` | Unternehmer nach BKP-Kategorie und Ortschaft, mit Ansprechpersonen und Notizen. |
| `dokumente.html` | Ordner und PDF aus dem Supabase-Storage. |
| `papierkorb-bereich.html` | Der Papierkorb der drei neuen Bereiche, `?bereich=mitarbeiter\|firmen\|ordner`. |

Der Weg durch die App: Übersicht → Projekt-Startseite → entweder ein neues
Baujournal oder ein bestehender Eintrag.

## Was die App kann

**Rundgang erfassen.** Datum steht auf heute und lässt sich ändern, der
Bauleiter kommt aus dem angemeldeten Konto. Wetter und Temperatur als
antippbare Chips, darunter die Checkliste, vier Freitextfelder und der
Fotos-Hinweis.

**Checkliste pro Projekt.** Jedes Projekt führt seine eigene Liste. Ein neues
Projekt startet mit den zehn üblichen Punkten, danach lässt sich jeder davon
umbenennen, entfernen oder ergänzen. Einen festen Sockel gibt es nicht.

Die Punkte werden bei jedem Eintrag als Momentaufnahme mitgespeichert, Text und
Status, nicht als Verweis auf die Projektvorlage. Wer später die Vorlage ändert,
ändert damit keinen einzigen bestehenden Eintrag. Für ein Journal, das im
Streitfall als Beweismittel dient, ist das der entscheidende Punkt.

**Papierkorb statt Löschen.** Ein Eintrag lässt sich aus den Listen nehmen, aber
nie wirklich löschen. `loesche_eintrag` setzt nur `geloescht_am` und
`geloescht_von`, `stelle_eintrag_wieder_her` setzt beides zurück. Der Papierkorb
eines Projekts zeigt, was wann von wem entfernt wurde, und holt es auf Knopfdruck
zurück. Ein endgültiges Löschen gibt es weder im Bildschirm noch in der
Datenbank: auf `eintraege` existiert bewusst keine delete-Policy.

**Gebäude und Bauteile.** Ein Projekt kann beliebig viele Baukörper führen,
gepflegt wie die Kontrollpunkte. Sind welche eingetragen, erscheint im Formular
über dem Baufortschritt die Zeile *Betrifft* mit Mehrfachauswahl und einem festen
Chip *Alle*. Der schliesst die Einzelauswahl aus und umgekehrt, gespeichert wird
genau das, was angetippt wurde. Führt ein Projekt keine Gebäude, fällt die Zeile
weg. Im Verlauf, in der Detailansicht und im Export steht die Auswahl neben den
übrigen Angaben.

**Angaben vom letzten Eintrag übernehmen.** Füllt nur, was gerade leer ist.
Schon getippter Text wird nie überschrieben.

**Autosave.** Der Formularinhalt wandert laufend nach `localStorage`. Nach einem
Absturz, einem Tab-Wechsel oder einem leeren Akku liegt beim nächsten Öffnen
alles wieder da.

**Randabstände auf dem Gerät.** Kopfzeile und Aktionsleiste rechnen
`env(safe-area-inset-*)` ein, damit auf iPhones nichts unter die abgerundete
Displayecke oder den Home-Indicator rutscht. Diese Abstände stehen in
`css/app.css` und dürfen im Markup nicht durch ein `padding`-Kürzel
überschrieben werden, sonst fallen sie lautlos wieder weg.

**Offline.** Der Service Worker legt die ganze App in den Cache, sie öffnet also
auch ohne Netz. Ein Eintrag, der ohne Empfang gespeichert wird, landet in einer
lokalen Warteschlange, erscheint sofort im Verlauf mit dem Vermerk *wartet* und
geht automatisch raus, sobald wieder Verbindung da ist. Die Zahl auf dem Würfel
neben dem Speichern-Knopf zeigt, wie viel noch offen ist.

**Korrekturen statt Überschreiben.** Ein gespeicherter Eintrag lässt sich
nachträglich korrigieren, aber nie stillschweigend. Jede Änderung landet als
eigene Zeile in `eintraege_korrekturen`, mit Feld, altem Wert, neuem Wert, Name
und Zeitpunkt, und steht im Eintrag unter *Nachträgliche Korrekturen*. Das
Baujournal dient im Streitfall als Beweismittel, ein rückwirkend spurlos
änderbares Protokoll verliert diese Beweiskraft.

**Export.** Im Eintrag zwei Knöpfe, *Als PDF* und *Als Word*. Im Verlauf lässt
sich über die Lupe ein Zeitraum filtern und die ganze Auswahl auf einmal
exportieren. Beides läuft im Browser, nichts geht an einen fremden Server.

**Archivieren statt löschen.** Ein archiviertes Projekt verschwindet aus der
Hauptübersicht und bleibt über den Archivfilter erreichbar. Gelöscht wird
nichts, wegen der Garantie- und Verjährungsfristen. Die Datenbank hat für
Projekte, Einträge und Korrekturen bewusst keine delete-Policy.

## Aufbau

```
index.html start.html
projekte.html projekt-start.html projekt.html
journal.html eintrag.html papierkorb.html
mitarbeiter.html firmenpool.html dokumente.html
papierkorb-bereich.html   ein Papierkorb für alle drei neuen Bereiche,
                          aufgerufen mit ?bereich=…
css/app.css          Schrift, Farben, Zustände, der gemeinsame Rahmen.
                     Die Screens tragen ihre Masse weiterhin inline, so
                     wie im Design-Prototyp. Die Abstände der
                     angehefteten Leisten stehen bewusst hier, nicht
                     inline: ein inline gesetztes padding würde die
                     Safe-Area wieder überschreiben.
js/logo.js           die einzige Logoquelle
js/config.js         Supabase-URL und anon key
js/app.js            Client, Session, Datumsformate, Sheets, Kontozeile
js/shell.js          die Seitenleiste ab 1024px, die vier Bereiche,
                     das Test-Banner (ein einziger Schalter)
js/start.js          die Startseite mit der Bereichsauswahl
js/store.js          Datenzugriff Baujournal, lokaler Spiegel,
                     Offline-Warteschlange
js/projekte.js js/projekt.js js/projekt-start.js
js/journal.js js/eintrag.js js/papierkorb.js
js/verlauf.js        Eintragszeile und Filter, geteilt von Startseite
                     und Papierkorb
js/export.js         PDF und Word
js/mitarbeiter.js js/firmenpool.js js/dokumente.js
js/papierkorb-bereich.js
api/search-ch.js     Serverless-Function als Proxy zur Tel-API von
                     search.ch, hält den Schlüssel serverseitig
vendor/              supabase-js, jsPDF, docx, SheetJS, lokal statt
                     vom CDN
assets/              Logo, PWA-Icons, Archivo als woff2
tools/build_icons.py erzeugt Logo und Icons neu
supabase/migrations/ das komplette Datenbankschema
manifest.json sw.js  PWA und Offline-Cache
```

Die Bereichsdateien kapseln sich alle in eine `(() => { … })()`. Klassische
`<script>`-Tags teilen sich einen einzigen globalen Raum, zwei gleichnamige
Deklarationen in zwei Dateien sind ein harter SyntaxError und die zweite Datei
läuft dann gar nicht. Genau das ist einmal passiert.

Alles liegt lokal im Repo, auch Schrift und Bibliotheken. Damit funktioniert die
App ohne Netz vollständig und lädt nichts von fremden Servern nach.

## Datenbank

Supabase-Projekt `baujournal-triga`, Region `eu-central-1`.

- `projekte` — Stammdaten, `kontrollpunkte` und `gebaeude` als JSON-Listen,
  `archiviert`
- `eintraege` — ein Rundgang, `kontrolle` als JSON mit der kompletten
  Punkteliste, `betrifft_gebaeude` als JSON-Liste, `geloescht_am` und
  `geloescht_von` für den Papierkorb
- `eintraege_korrekturen` — das Korrekturprotokoll, nur lesen und anhängen
- `profile` — Anzeigename je Konto, weil `auth.users` vom Client aus nicht
  lesbar ist. Wird automatisch angelegt, sobald ein Konto entsteht
- `mitarbeiter` — das Adressbuch des Teams, bewusst getrennt von den
  Login-Konten. Einen Eintrag zu löschen berührt kein Konto
- `ordner`, `dateien` — die Dokumentenablage, die PDF selbst liegt im
  Storage-Bucket `dokumente`
- `bkp_liste` — die BKP-Kategorien des Firmenpools, als Daten und nicht
  hart codiert
- `firmen` — nur der Name ist Pflicht, die BKP-Codes stehen als
  JSON-Liste im Feld `bkp_codes`
- `ansprechpersonen`, `notizen` — Unterdetails einer Firma
- `projekteinsaetze` — welche Firma auf welchem Projekt im Einsatz war,
  noch ohne eigene Oberfläche

Auf allen Tabellen ist Row Level Security aktiv, jede Policy verlangt die
Rolle `authenticated`. Ohne Login liefert jede Abfrage leer zurück. Alle
Teammitglieder sehen alles und dürfen überall erfassen, Rollen gibt es keine.

Gelöscht wird nirgends wirklich. `projekte`, `eintraege`, `mitarbeiter`,
`ordner`, `dateien`, `bkp_liste` und `firmen` tragen `geloescht_am` und
`geloescht_von` und haben schlicht keine Delete-Policy: ein DELETE über die
API trifft dort null Zeilen. Wer und wann gelöscht hat, trägt der Trigger
`setze_loeschspur()` serverseitig ein, der Client kann das nicht fälschen.
Die einzigen Ausnahmen sind `ansprechpersonen` und `notizen`, die zu genau
einer Firma gehören und bewusst direkt löschbar sind.

Die Ampelfarbe einer Firma ist nirgends gespeichert. Sie ist die Farbe der
jüngsten Notiz, ohne Notiz bleibt sie grau. Damit gibt es keine zweite
Wahrheit, die irgendwann von den Notizen abweicht.

Die Korrektur läuft über die Datenbankfunktion `korrigiere_eintrag`. Die
schreibt Protokoll und neue Werte in derselben Transaktion, entweder beides oder
nichts, und läuft als `security invoker`, damit RLS greift. Ebenso
`loesche_eintrag` und `stelle_eintrag_wieder_her`.

Ein Fallstrick beim Abfragen: zwischen `eintraege.ersteller_id` und `profile.id`
gibt es keinen Fremdschlüssel, den PostgREST sieht, der zeigt auf `auth.users`.
Eine eingebettete Abfrage wie `select('*, profile:ersteller_id(name)')`
scheitert deshalb. Die Namen werden stattdessen einmal geladen und im Client
zugeordnet, siehe `js/store.js`.

`js/config.js` enthält URL und anon key. Beides ist öffentlich und gehört so in
den Client, der Schutz kommt von RLS. Der `service_role` key darf nie ins Repo,
der umgeht RLS vollständig.

## Logo

Es gibt genau eine Logoquelle: `assets/triga-logo.png`, die vollständige
Wortbildmarke für dunkle Flächen. Wer das Logo braucht, schreibt
`<div data-logo="34"></div>` ins Markup, die Zahl ist die Höhe in Pixeln.
`js/logo.js` setzt es ein. Kein Zeichen allein, kein Schriftzug allein, keine
zweite Variante.

Erzeugt wird die Datei aus der Originaldatei `assets/triga-logo-master.jpg`:

```
python3 tools/build_icons.py    # braucht pillow
```

Das Original ist ein CMYK-JPEG. CMYK-JPEG rendert in Browsern unzuverlässig,
auf iOS teilweise mit falschen Farben, und JPEG setzt an den harten Kanten des
Schriftzugs Artefakte. Daraus entsteht deshalb ein RGB-PNG mit 16-Farben-Palette,
sichtbar identisch und ein Viertel so gross. Hintergrund, Rot und Weiss der
Originaldatei stimmen exakt mit der Palette der App überein (`#00233f`,
`#b20000`, `#ffffff`), das Logo fügt sich daher nahtlos in die Navy-Flächen ein.

Dasselbe Skript schneidet aus derselben Datei die App-Icons. Die zeigen als
einzige Stelle nur das Zeichen ohne Schriftzug: auf 180 × 180 Pixeln wäre
«BAUMANAGEMENT» nicht mehr lesbar und das Logo fiele zu einem grauen Strich
zusammen.

Im PDF-Export wird dieselbe Datei eingebettet, siehe `js/export.js`.

## Umgebungsvariablen

Eine einzige, und die ist optional:

| Name | Wofür |
|---|---|
| `SEARCH_CH_API_KEY` | Schlüssel für die Tel-API von search.ch. Wird in den Projekteinstellungen von Vercel gesetzt, nicht im Repo. |

Der Schlüssel bleibt in `api/search-ch.js` und erreicht den Browser nie. Ist
er nicht gesetzt, antwortet die Function mit einem Hinweis, und der
Firmenpool funktioniert vollständig weiter — nur die Adresssuche beim
Erfassen einer neuen Firma sagt dann, dass noch kein Schlüssel hinterlegt
ist.

## Entwickeln

Es gibt nichts zu bauen. Statisch ausliefern genügt:

```
npx http-server . -p 8080 -c-1
```

Nach einer Änderung an einer Datei aus der Liste in `sw.js` die `VERSION` dort
hochzählen, sonst hält der Service Worker die alte Fassung fest.

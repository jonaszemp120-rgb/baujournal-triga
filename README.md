# TRIGA App · TRIGA Baumanagement AG

Die interne App der TRIGA Baumanagement AG. Vier Bereiche, ein Login, eine
Adresse: **Mitarbeiter**, **Baujournal**, **Firmenpool**, **Dokumente**. Läuft
im Browser, lässt sich auf dem Handy zum Homescreen hinzufügen und funktioniert
im Baujournal auch ohne Empfang, etwa in der Tiefgarage oder im Rohbau.

Kein Build-Schritt, kein Framework. Reines HTML, CSS und JavaScript, das Vercel
direkt als statische Seiten ausliefert. Wer am Code etwas ändert, öffnet die
Datei, speichert, fertig.

## Die vier Bereiche

**Mitarbeiter** ist das Adressbuch des Teams, bewusst getrennt von den
Login-Konten. Telefon und E-Mail sind direkt antippbar. Einen Eintrag hier zu
löschen berührt kein Konto — die Tabelle kennt `auth.users` gar nicht als
Person. Konten legt weiterhin nur die Geschäftsleitung im Supabase-Dashboard an.

**Baujournal** ist das Bautagebuch: Projekte, Rundgänge, Checkliste,
Korrekturprotokoll, Export als PDF und Word. Der Bereich mit dem meisten
Gewicht, siehe den eigenen Abschnitt weiter unten.

**Firmenpool** sind die Unternehmer, geordnet nach BKP-Kategorie und danach nach
Ortschaft. Pro Firma Ansprechpersonen, Notizen mit Ampelfarbe, vCard-Export,
Excel-Export der gefilterten Liste und ein Import mit Spaltenzuordnung. Beim
Erfassen einer neuen Firma lassen sich Adresse und Nummer über search.ch holen.

**Dokumente** ist eine freie Ordnerablage für PDF, mit Dateiname, Datum und
hochladender Person.

## Screens

| Datei | Zweck |
|---|---|
| `index.html` | Anmeldung. Kein Selbstregistrieren, Konten legt die Geschäftsleitung im Supabase-Dashboard an. |
| `start.html` | Die Startseite nach dem Login: Auswahl zwischen den vier Bereichen, mit Zahlen aus der Datenbank. |
| `mitarbeiter.html` | Das Adressbuch des Teams. |
| `projekte.html` | Übersicht aller Baustellen, mit Suche und Archivfilter. |
| `projekt-start.html` | Startseite einer Baustelle: neues Baujournal, abgeschlossene Einträge, Papierkorb. |
| `projekt.html` | Projekt anlegen und bearbeiten. Ohne `?id=` neu, mit `?id=` bestehend. |
| `journal.html` | Das Formular für den Rundgang. |
| `eintrag.html` | Ein einzelner Eintrag: lesen, korrigieren, exportieren, löschen. |
| `papierkorb.html` | Die gelöschten Einträge eines Projekts, mit Wiederherstellen. |
| `firmenpool.html` | Unternehmer nach BKP-Kategorie und Ortschaft, mit Ansprechpersonen und Notizen. |
| `dokumente.html` | Ordner und PDF aus dem Supabase-Storage. |
| `papierkorb-bereich.html` | Der Papierkorb der drei neuen Bereiche, `?bereich=mitarbeiter`, `firmen` oder `ordner`. |

## Durchgängige Prinzipien

Vier Regeln gelten in der ganzen App gleich. Wer etwas Neues dazubaut, hält
sich daran, sonst fällt es sofort auf.

**Was sich anlegen lässt, lässt sich auch ändern und wieder entfernen.** Keine
Sackgasse, in der ein Tippfehler für immer stehen bleibt.

| Was | Anlegen | Ändern | Entfernen |
|---|---|---|---|
| Projekt | `projekte.html` | `projekt.html?id=` | archivieren, kein Löschen |
| Kontrollpunkte eines Projekts | `projekt.html` | dort | dort |
| Gebäude und Bauteile | `projekt.html` | dort | dort |
| Eintrag | `journal.html` | korrigieren in `eintrag.html`, mit Protokoll | Papierkorb des Projekts |
| Mitarbeiter | `mitarbeiter.html` | dort | Papierkorb Mitarbeiter |
| Ordner | `dokumente.html` | umbenennen | Papierkorb Dokumente |
| Datei | hochladen | umbenennen | Papierkorb Dokumente |
| BKP-Kategorie | `firmenpool.html` | dort | Papierkorb Firmenpool |
| Firma | `firmenpool.html` | dort | Papierkorb Firmenpool |
| Ansprechperson | in der Firma | dort | direkt, ohne Papierkorb |
| Notiz | in der Firma | dort | direkt, ohne Papierkorb |
| Eigener Anzeigename | — | über den Kreis mit den Initialen | — |

Zwei bewusste Ausnahmen. **Projekte** werden archiviert statt gelöscht, wegen
der Garantie- und Verjährungsfristen. **Ansprechpersonen und Notizen** hängen an
genau einer Firma, sind kein eigenständiger Datensatz mit Beweischarakter und
werden darum direkt gelöscht; eine falsch gelöschte Person ist in Sekunden neu
erfasst. Die Rückfrage sagt das jeweils auch so.

**Der Papierkorb funktioniert überall gleich.** Löschen setzt `geloescht_am`,
nichts verschwindet. Jeder Bereich hat seine eigene Papierkorb-Ansicht mit Name,
Datum, löschender Person und einem Knopf zum Zurückholen. Ein endgültiges
Löschen gibt es weder auf dem Bildschirm noch über die API: den betroffenen
Tabellen fehlt schlicht die Delete-Policy.

**Responsive ist keine Zugabe.** Jeder Screen muss auf dem Handy und auf einem
grossen Bildschirm brauchbar sein. Ab 1024px tritt die permanente Seitenleiste
dazu und der Inhalt verteilt sich auf die Breite, darunter bleibt es die
Handyspalte mit Zurück-Pfeil. Das gilt auch für das bestehende Baujournal.

**Nichts kommt von einem fremden Server.** Schrift, Bibliotheken und Logo liegen
im Repo. Die einzige Ausnahme ist die Serverless-Function zu search.ch, und die
wird nur auf Klick angefragt.

## Was das Baujournal kann

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
zurück.

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

**Offline.** Der Service Worker legt die ganze App in den Cache, sie öffnet also
auch ohne Netz. Ein Eintrag, der ohne Empfang gespeichert wird, landet in einer
lokalen Warteschlange, erscheint sofort im Verlauf mit dem Vermerk *wartet* und
geht automatisch raus, sobald wieder Verbindung da ist. Die Zahl auf dem Würfel
neben dem Speichern-Knopf zeigt, wie viel noch offen ist.

Die drei neuen Bereiche zeigen offline den zuletzt geladenen Stand und sagen das
auch in einer Zeile oben. Geändert wird dort erst wieder mit Verbindung, eine
zweite Warteschlange wäre mehr Risiko als Nutzen.

**Korrekturen statt Überschreiben.** Ein gespeicherter Eintrag lässt sich
nachträglich korrigieren, aber nie stillschweigend. Jede Änderung landet als
eigene Zeile in `eintraege_korrekturen`, mit Feld, altem Wert, neuem Wert, Name
und Zeitpunkt, und steht im Eintrag unter *Nachträgliche Korrekturen*. Das
Baujournal dient im Streitfall als Beweismittel, ein rückwirkend spurlos
änderbares Protokoll verliert diese Beweiskraft.

**Export.** Im Eintrag zwei Knöpfe, *Als PDF* und *Als Word*. Im Verlauf lässt
sich über die Lupe ein Zeitraum filtern und die ganze Auswahl auf einmal
exportieren. Beides läuft im Browser, nichts geht an einen fremden Server.

**Randabstände auf dem Gerät.** Kopfzeile und Aktionsleiste rechnen
`env(safe-area-inset-*)` ein, damit auf iPhones nichts unter die abgerundete
Displayecke oder den Home-Indicator rutscht. Diese Abstände stehen in
`css/app.css` und dürfen im Markup nicht durch ein `padding`-Kürzel
überschrieben werden, sonst fallen sie lautlos wieder weg.

## Aufbau

```
index.html start.html
projekte.html projekt-start.html projekt.html
journal.html eintrag.html papierkorb.html
mitarbeiter.html firmenpool.html dokumente.html
papierkorb-bereich.html   ein Papierkorb für alle drei neuen Bereiche,
                          aufgerufen mit ?bereich=…
css/app.css          Schrift, Farben, Zustände, der gemeinsame Rahmen.
                     Die Baujournal-Screens tragen ihre Masse weiterhin
                     inline, so wie im Design-Prototyp. Die Abstände der
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

Zwei Dinge, an denen man sich sonst die Zähne ausbeisst:

Die Bereichsdateien kapseln sich alle in eine `(() => { … })()`. Klassische
`<script>`-Tags teilen sich einen einzigen globalen Raum, zwei gleichnamige
Deklarationen in zwei Dateien sind ein harter SyntaxError und die zweite Datei
läuft dann gar nicht. Genau das ist einmal passiert.

`box-sizing` ist nicht global auf `border-box` gesetzt, weil die
Baujournal-Screens ihre Masse inline tragen. Alles, was für die TRIGA App neu
dazugekommen ist, trägt eine Klasse mit Präfix (`tr-`, `br-`, `dk-`, `fp-`,
`pk-`, `st-`), und für genau diese Präfixe steht `border-box` an einer Stelle in
`css/app.css`. Ohne das läuft jede Zeile mit `width:100%` und seitlichem Polster
um dieses Polster aus dem Bild.

## Datenbank

Supabase-Projekt `baujournal-triga`, Region `eu-central-1`. Eine Datenbank für
alle vier Bereiche.

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

## Test-Banner

Über jedem Startbildschirm steht die rote Zeile «Test-Version — Nutzung noch
nicht endgültig entschieden.» Sie hängt an einem einzigen Schalter in
`js/shell.js`:

```js
const TEST_BANNER = true;
```

Auf `false` setzen und die Zeile ist überall weg. Kein zweiter Ort, an dem noch
ein Rest stehen bleibt.

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

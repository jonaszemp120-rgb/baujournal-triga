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
| `projekt.html` | Projekt anlegen und bearbeiten. Ohne `?id=` neu, mit `?id=` bestehend. |
| `journal.html` | Das eigentliche Formular für den Rundgang, darunter der Verlauf. |
| `eintrag.html` | Ein einzelner Eintrag: lesen, korrigieren, als PDF oder Word exportieren. |

## Was die App kann

**Rundgang erfassen.** Datum steht auf heute und lässt sich ändern, der
Bauleiter kommt aus dem angemeldeten Konto. Wetter und Temperatur als
antippbare Chips, darunter die Checkliste, vier Freitextfelder und der
Fotos-Hinweis.

**Checkliste pro Projekt.** Zehn Basispunkte gelten überall, jedes Projekt kann
beliebig viele eigene ergänzen. Die ergänzten tragen im Formular das Label
*Projektspezifisch*. Die Punkte werden bei jedem Eintrag mitgespeichert, nicht
nur referenziert. Ändert jemand später die Checkliste eines Projekts, bleiben
alte Einträge deshalb genau so stehen, wie sie erfasst wurden.

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
index.html projekte.html projekt.html journal.html eintrag.html
css/app.css          Schrift, Farben, Zustände. Die Screens tragen ihre
                     Masse weiterhin inline, so wie im Design-Prototyp.
js/config.js         Supabase-URL und anon key
js/app.js            Client, Session, Datumsformate, Kontozeile
js/store.js          Datenzugriff, lokaler Spiegel, Offline-Warteschlange
js/projekte.js js/projekt.js js/journal.js js/eintrag.js
js/export.js         PDF und Word
vendor/              supabase-js, jsPDF, docx, lokal statt vom CDN
assets/              Marke als SVG, PWA-Icons, Archivo als woff2
tools/build_icons.py erzeugt Marke und Icons neu
supabase/migrations/ das komplette Datenbankschema
manifest.json sw.js  PWA und Offline-Cache
```

Alles liegt lokal im Repo, auch Schrift und Bibliotheken. Damit funktioniert die
App ohne Netz vollständig und lädt nichts von fremden Servern nach.

## Datenbank

Supabase-Projekt `baujournal-triga`, Region `eu-central-1`.

- `projekte` — Stammdaten, `zusatz_kontrollpunkte` als JSON-Liste, `archiviert`
- `eintraege` — ein Rundgang, `kontrolle` als JSON mit der kompletten Punkteliste
- `eintraege_korrekturen` — das Korrekturprotokoll, nur lesen und anhängen
- `profile` — Anzeigename je Konto, weil `auth.users` vom Client aus nicht
  lesbar ist. Wird automatisch angelegt, sobald ein Konto entsteht

Auf allen vier Tabellen ist Row Level Security aktiv, jede Policy verlangt die
Rolle `authenticated`. Ohne Login liefert jede Abfrage leer zurück. Alle
Teammitglieder sehen alle Projekte und dürfen überall erfassen, Rollen gibt es
keine.

Die Korrektur läuft über die Datenbankfunktion `korrigiere_eintrag`. Die
schreibt Protokoll und neue Werte in derselben Transaktion, entweder beides oder
nichts, und läuft als `security invoker`, damit RLS greift.

`js/config.js` enthält URL und anon key. Beides ist öffentlich und gehört so in
den Client, der Schutz kommt von RLS. Der `service_role` key darf nie ins Repo,
der umgeht RLS vollständig.

## Marke und Icons

Die TRIGA-Marke liegt als Vektor in `assets/triga-mark-light.svg` (Klammer
weiss, für Navy-Flächen) und `assets/triga-mark-navy.svg` (für helle Flächen).
Im Login und in den Kopfzeilen steht sie als Inline-SVG, das Wort TRIGA daneben
ist normaler Text in Archivo. Durchgehend Marken-Rot `#b20000`, auch im Icon,
bewusst kein zweiter Rot-Ton.

Die PWA-Icons entstehen aus derselben Geometrie:

```
python3 tools/build_icons.py    # braucht pillow
```

## Entwickeln

Es gibt nichts zu bauen. Statisch ausliefern genügt:

```
npx http-server . -p 8080 -c-1
```

Nach einer Änderung an einer Datei aus der Liste in `sw.js` die `VERSION` dort
hochzählen, sonst hält der Service Worker die alte Fassung fest.

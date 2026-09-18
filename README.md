# TRIGA App · TRIGA Baumanagement AG

Die interne App der TRIGA Baumanagement AG. Acht Bereiche, ein Login, eine
Adresse: **Feed**, **Mitarbeiter**, **Projekte**, **Baujournal**,
**Firmenpool**, **Dokumente**, **Chat**, **Formulare**. Läuft
im Browser, lässt sich auf dem Handy zum Homescreen hinzufügen und funktioniert
im Baujournal auch ohne Empfang, etwa in der Tiefgarage oder im Rohbau.

Kein Build-Schritt, kein Framework. Reines HTML, CSS und JavaScript, das Vercel
direkt als statische Seiten ausliefert. Wer am Code etwas ändert, öffnet die
Datei, speichert, fertig.

## Die acht Bereiche

**Feed** ist der Aushang des Betriebs. Ein Strom, chronologisch, sichtbar für
alle. Zwei Arten stehen darin: ein Beitrag mit Text, optional einem Foto und
optional einem Projekt, und eine Umfrage mit Frage und Antwortmöglichkeiten.
Ein Beitrag trägt die Kategorie **Update** oder **Wichtig**; ein wichtiger
bekommt einen roten Rahmen und fällt damit auf, was sonst nirgends in der App
vorkommt. Herz und Kommentare gibt es an beidem. An einem Beitrag hängen
beliebig viele Fotos, durch die man im Feed wischt, und in Text wie Kommentar
lässt sich mit **@** jemand direkt ansprechen — wer erwähnt wird, bekommt eine
Meldung aufs Telefon.

**Mitarbeiter** ist das Adressbuch des Teams, bewusst getrennt von den
Login-Konten. Telefon und E-Mail sind direkt antippbar. Einen Eintrag hier zu
löschen berührt kein Konto — die Tabelle kennt `auth.users` gar nicht als
Person. Konten legt weiterhin nur die Geschäftsleitung im Supabase-Dashboard an.

**Projekte** ist die Klammer um alles andere. Ein Projekt führt seine
Stammdaten, die Unternehmerliste mit Gewerk, Status und Auftragssumme, die
zuständigen Mitarbeiter mit ihrer Rolle auf diesem Projekt — Bauleiter,
Projektleiter oder Unterstützung, als Vorschläge in einem Freitextfeld, an
denen bewusst keine Rechte hängen —, die offenen Pendenzen, die letzten
Baujournal-Einträge und die zugeordneten Dokumentenordner. Die Projektseite
zeigt jeden dieser Teile als Auszug und verlinkt in den Bereich, der die volle
Ansicht hat.

Die **Sitzungsprotokolle** hängen ebenfalls am Projekt. Ein Protokoll trägt
Datum, Ort, eine pro Projekt fortlaufende Nummer und eine Traktandenliste, dazu
die Teilnehmenden mit Vorsitz, anwesend, abwesend oder Verteiler. Zu jedem
Traktandum kommen Text und optional ein Foto; daraus wird auf Wunsch ein
Beschluss oder eine Pendenz. Am Schluss entsteht ein PDF, und ab dann ist das
Protokoll zu.

Die **Pendenzen** sind bewusst vom Baujournal getrennt. Das Journal ist das
Tagesprotokoll und gehört einem Datum; eine Pendenz bleibt über die Tage offen,
bis jemand sie abhakt. Pro Punkt gibt es einen Beschrieb und optional eine
zuständige Firma aus der Unternehmerliste des Projekts — kein Fälligkeitsdatum,
keine Priorität, keine Zuweisung an eine Person. Erledigte Punkte verschwinden
nicht, sie stehen durchgestrichen in der vollen Liste.

**Baujournal** ist das Bautagebuch: Projekte, Rundgänge, Checkliste,
Korrekturprotokoll, Export als PDF und Word. Der Bereich mit dem meisten
Gewicht, siehe den eigenen Abschnitt weiter unten.

**Firmenpool** sind die Unternehmer, geordnet nach BKP-Kategorie und danach nach
Ortschaft. Pro Firma Ansprechpersonen, Notizen mit Ampelfarbe, vCard-Export,
Excel-Export der gefilterten Liste und ein Import mit Spaltenzuordnung. Beim
Erfassen einer neuen Firma lassen sich Adresse und Nummer über search.ch holen.

**Dokumente** ist eine freie Ordnerablage für PDF, mit Dateiname, Datum und
hochladender Person.

**Chat** ist die interne Unterhaltung: Einzelgespräche und Gruppen, Text,
Emoji und Bilder, in Echtzeit über Supabase Realtime. Ein Einzelchat wird nicht
angelegt, er entsteht beim ersten Öffnen eines Gesprächs mit jemandem. Gruppen
legt man bewusst an, mit Namen und Mitgliedern; pflegen darf sie, wer sie
erstellt hat.

Bilder leben **30 Tage**, danach verschwinden sie wirklich — die Datei wird aus
dem Storage gelöscht, nicht bloss ausgeblendet. Der Verlauf bleibt vollständig,
an der Stelle steht danach der Hinweis, dass es das Bild einmal gab. Eine
Galerie «alle Bilder dieses Chats» gibt es bewusst nicht: sie würde aus dem
Gesprächsverlauf ein Fotoarchiv machen, und genau das soll er nicht sein.

Jede Nachricht trägt ihre Uhrzeit, ältere zusätzlich das Datum. Eigene
Nachrichten zeigen einen Haken, sobald sie in der Datenbank stehen, und zwei,
sobald alle anderen gelesen haben. Löschen geht: die eigene Nachricht, die
dann als «Nachricht gelöscht» stehen bleibt, und das ganze Gespräch, das für
alle verschwindet. Ändern geht nicht — ein Verlauf, den man umschreiben kann,
ist keiner mehr.

**Formulare** sind die Anträge: Spesen mit Betrag, Beschrieb und optional einem
fotografierten Beleg, Ferien mit Zeitraum und optionaler Bemerkung. Ein Antrag
geht einen Weg und nur einen — eingereicht, dann genehmigt oder abgelehnt. Wer
die erweiterte Stufe hat, sieht zusätzlich alle offenen Anträge der anderen und
entscheidet direkt in der Liste. Solange niemand entschieden hat, lässt sich ein
eigener Antrag zurückziehen; danach ist er ein Nachweis und bleibt stehen.

Die **Bauabnahme** gehört keinem Bereich, sondern einem Projekt, und ist über
die Projektseite erreichbar. Sie zeigt den Grundriss aus den Projekt-Dokumenten,
und ein Tipp darauf setzt eine nummerierte Stecknadel: Beschrieb, zuständige
Firma aus der Unternehmerliste, Frist, Foto. Am Schluss unterschreiben beide
Seiten — die TRIGA-Person mit der im Profil hinterlegten Unterschrift, die
Bauherrschaft oder Firma auf dem Gerät —, und daraus entsteht ein PDF-Protokoll,
das im Bereich Dokumente des Projekts landet. Ab dann ist die Abnahme zu.

Daneben steht **Mein Profil**, kein Bereich, sondern die eigene Seite jeder
angemeldeten Person: erreichbar über das Konto-Feld unten in der Seitenleiste
und über den Kreis mit den Initialen auf der Startseite. Dort pflegt jede Person
Telefonnummer und E-Mail selbst und hinterlegt einmal ihre Unterschrift. Name
und Funktion bleiben bei der Administration.

Das Profil zeigt keine Kopie: es ist dieselbe Zeile aus `mitarbeiter`, die auch
in der Liste und bei den Projektzuordnungen steht. Gefunden wird sie über
`mitarbeiter.user_id = auth.uid()`; die Seite nimmt keine ID aus der Adresszeile
entgegen, es gibt also keinen Weg, über sie an fremde Daten zu kommen. Die
Verknüpfung über den Schlüssel statt über die E-Mail ist Absicht — die E-Mail
darf jede Person selbst ändern, und ein Tippfehler darf niemanden aus dem
eigenen Profil aussperren.

Die **Unterschrift** liegt als PNG in einer Data-URL an derselben Zeile. Sie
wird beim Speichern auf den beschriebenen Bereich zugeschnitten, das hält sie
bei rund zehn Kilobyte. Neu erfassen überschreibt die alte, eine Historie gibt
es bewusst nicht. Wer sie später braucht — Bauabnahme, Protokolle — ruft
`meineUnterschrift()` aus `js/app.js` auf. Die Funktion wirft nie, sondern
liefert im Zweifel den Satz, der dem Benutzer zu zeigen ist; `unterschriftBlock()`
macht daraus entweder das Bild oder den Hinweis mit dem Weg ins Profil. Damit
steht dort später kein roter Fehler, wo in Wahrheit nur noch nicht unterschrieben
wurde.

## Screens

| Datei | Zweck |
|---|---|
| `index.html` | Anmeldung. Kein Selbstregistrieren, Konten legt die Geschäftsleitung im Supabase-Dashboard an. |
| `start.html` | Die Startseite nach dem Login: die sechs Kacheln mit Zahlen aus der Datenbank, darüber auf dem Handy die Zeilen zu Feed und Formularen. |
| `feed.html` | Der Feed: Beiträge und Umfragen, mit Filter, Herz und Kommentaren, in Echtzeit. |
| `formulare.html` | Spesen- und Ferienanträge: einreichen, zurückziehen, entscheiden. |
| `abnahme.html` | Die Bauabnahme eines Projekts: Plan, Mängel, Abschluss, `?projekt=` und optional `?abnahme=`. |
| `protokolle.html` | Die Sitzungsprotokolle eines Projekts als Liste, `?projekt=`. |
| `protokoll.html` | Ein Sitzungsprotokoll: Kopfdaten, Teilnehmende, Traktanden, Abschluss, `?protokoll=`. |
| `suche.html` | Die globale Suche über Projekte, Firmen, Mitarbeiter und Dokumente. |
| `profil.html` | Mein Profil: eigene Kontaktdaten und eigene Unterschrift. |
| `chat.html` | Der Chat: Gespräche links, das offene rechts, `?chat=`. |
| `mitarbeiter.html` | Das Adressbuch des Teams. |
| `projekte-bereich.html` | Der Bereich Projekte: alle Projekte als Karten, gefiltert nach Status. |
| `projekt-detail.html` | Die Projektseite mit Stammdaten, Unternehmerliste, Mitarbeitern, Pendenzen, Bauabnahmen, Journal, Sitzungsprotokollen, Feed-Beiträgen und Dokumenten. |
| `pendenzen.html` | Alle Pendenzen eines Projekts, offene und erledigte, `?projekt=`. |
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
| Projekt | `projekte-bereich.html` | dort oder `projekt.html?id=` | archivieren, kein Löschen |
| Firma auf einem Projekt | `projekt-detail.html` | dort (Gewerk, Status, Summe) | direkt, ohne Papierkorb |
| Mitarbeiter auf einem Projekt | `projekt-detail.html` | dort (Rolle) | direkt, ohne Papierkorb |
| Pendenz | `projekt-detail.html` oder `pendenzen.html` | dort | direkt, ohne Papierkorb |
| Projekt eines Ordners | `dokumente.html` | dort | Feld leeren |
| Projekt einer Notiz | in der Firma | dort | Auswahl zurücksetzen |
| Kontrollpunkte eines Projekts | `projekt.html` | dort | dort |
| Gebäude und Bauteile | `projekt.html` | dort | dort |
| Eintrag | `journal.html` | korrigieren in `eintrag.html`, mit Protokoll | Papierkorb des Projekts |
| Mitarbeiter | `mitarbeiter.html`, Geschäftsleitung | dort | Papierkorb Mitarbeiter, Geschäftsleitung |
| Ordner | `dokumente.html` | umbenennen | Papierkorb Dokumente |
| Datei | hochladen | umbenennen | Papierkorb Dokumente |
| BKP-Kategorie | `firmenpool.html` | dort | Papierkorb Firmenpool |
| Firma | `firmenpool.html` | dort | Papierkorb Firmenpool |
| Ansprechperson | in der Firma | dort | direkt, ohne Papierkorb |
| Notiz | in der Firma | dort | direkt, ohne Papierkorb |
| Antrag | `formulare.html` | gar nicht, ein Antrag steht wie eingereicht | zurückziehen, solange niemand entschieden hat |
| Bauabnahme | `abnahme.html` | bis zum Abschluss | bis zum Abschluss, danach nie mehr |
| Mangel | auf dem Plan | bis zum Abschluss | direkt, solange er offen ist |
| Beitrag oder Umfrage | `feed.html` | gar nicht, ein Beitrag steht wie gepostet | direkt, ohne Papierkorb, eigene immer, fremde mit erweiterter Stufe |
| Kommentar | unter einem Beitrag | gar nicht | direkt, ohne Papierkorb, wie beim Beitrag |
| Eigener Anzeigename | — | über den Kreis mit den Initialen | — |
| Eigene Kontaktdaten | — | `profil.html` | — |
| Eigene Unterschrift | `profil.html` | dort neu erfassen | dort |
| Gruppenchat | `chat.html` | Mitglieder, durch die erstellende Person | direkt, durch jedes Mitglied |
| Einzelchat | entsteht beim ersten Öffnen | — | direkt, durch beide Seiten |
| Nachricht | `chat.html` | — | direkt, nur durch die schreibende Person |

Eine dritte Stelle weicht ab: **Nachrichten** im Chat lassen sich löschen, aber
nicht ändern. Ein Gespräch, das sich nachträglich umschreiben lässt, ist kein
Gesprächsverlauf mehr. Gelöscht heisst deshalb: der Inhalt geht weg, die Zeile
bleibt und trägt den Vermerk «Nachricht gelöscht». Ein ganzes Gespräch dagegen
verschwindet wirklich, mit allen Nachrichten und Bildern und für alle
Beteiligten — ein «nur bei mir ausblenden» wäre ein zweiter Zustand neben dem
ersten, und niemand wüsste mehr, was die anderen sehen. Einen Papierkorb gibt
es dafür nicht: ein Gespräch ist kein Dokument mit Beweischarakter.

Zwei bewusste Ausnahmen. **Projekte** werden archiviert statt gelöscht, wegen
der Garantie- und Verjährungsfristen. **Unterdetails** — Ansprechpersonen,
Notizen, Pendenzen und die beiden Projektzuordnungen — hängen an genau einem Datensatz,
haben keinen Beweischarakter und werden direkt gelöscht; eine falsch entfernte
Zuordnung ist mit zwei Klicks wieder gesetzt. Die Rückfrage sagt das jeweils
auch so.

**Jede Angabe hat genau einen Ort zum Pflegen.** Die Unternehmerliste wird auf
der Projektseite gepflegt; im Firmenpool steht dieselbe Zuordnung, aber nur zum
Lesen. Die Adresse eines Projekts steht in einer Spalte, nicht in zweien. Mein
Profil ist keine zweite Kopie der Kontaktdaten, sondern dieselbe Zeile aus
`mitarbeiter`, die auch die Mitarbeiter-Liste zeigt. Wo es zwei Orte gäbe,
laufen die Angaben früher oder später auseinander.

**Der Papierkorb funktioniert überall gleich.** Löschen setzt `geloescht_am`,
nichts verschwindet. Jeder Bereich hat seine eigene Papierkorb-Ansicht mit Name,
Datum, löschender Person und einem Knopf zum Zurückholen. Ein endgültiges
Löschen gibt es weder auf dem Bildschirm noch über die API: den betroffenen
Tabellen fehlt schlicht die Delete-Policy.

**Responsive ist keine Zugabe.** Jeder Screen muss auf dem Handy und auf einem
grossen Bildschirm brauchbar sein. Ab 1024px tritt die permanente Seitenleiste
dazu und der Inhalt verteilt sich auf die Breite, darunter bleibt es die
Handyspalte mit Zurück-Pfeil. Das gilt auch für das bestehende Baujournal.

**Auf dem Handy wird nicht gezoomt.** Jede Seite trägt dasselbe viewport-Meta mit
`maximum-scale=1, user-scalable=no`, dazu steht `touch-action:manipulation` auf
`html` gegen den Doppeltipp-Zoom. Die App soll sich wie eine App anfassen und
nicht wie eine Webseite, die beim zweiten Tippen wegspringt. Die
Schriftvergrösserung aus den Einstellungen des Geräts bleibt davon unberührt:
die läuft nicht über den Zoom, und `text-size-adjust` steht nirgends auf `none`.
Wer eine neue Seite anlegt, kopiert die Meta-Zeile mit — eine Seite ohne sie
fällt aus der Reihe, und genau das prüft die Testsuite über alle Seiten.

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

Das gilt für jede Breite, nicht nur fürs Handy. Auf dem iPad steht die Uhr
über der installierten App, und dort tragen die Kopfzeile **und die
Seitenleiste** denselben Abstand — sonst blieb oben ein milchiger Streifen
stehen, weil die Farbe der App gar nicht bis unter die Statusleiste reichte.
Wer eine neue Kopfzeile baut, gibt ihr `padding-top:env(safe-area-inset-top)`
und lässt ihren Hintergrund bis `top:0` laufen; ein Abstand *über* der Leiste
löst das Problem nicht, er verschiebt es nur.

**Und die Kopfzeile allein genügt auf dem iPad trotzdem nicht.** `body` hat bis
1024px eine Höchstbreite von 430px und steht mittig — auf dem Handy ist das die
ganze Breite, auf einem iPad im Hochformat (744 bis 834px) nicht. Links und
rechts davon liegt der Seitenhintergrund, und ausgerechnet dort steht die Uhr:
am rechten Rand, weit ausserhalb der Spalte. Die Kopfzeile kann diese Stelle
nicht abdecken, sie ist ja selbst nur so breit wie die Spalte. Deshalb legt
jede Kopfzeile über `::before` einen Streifen über die **ganze** Fensterbreite,
in ihrer eigenen Farbe (`background-color:inherit`, damit navy navy bleibt und
weiss weiss). Am hellen Streifen unter der Uhr auf dem Baujournal-Screen liess
sich das gut sehen, auf den weissen Kopfzeilen kaum — der Fehler war derselbe.
Geprüft wird das nicht mehr am Aufbau der Seite, sondern am Bild: die Testreihe
`safearea-ipad.mjs` fotografiert die oberste Zeile in acht iPad-Grössen auf
jeder Seite der App und liest die Pixel.

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
js/shell.js          die Seitenleiste ab 1024px, die acht Bereiche,
                     das Test-Banner (ein einziger Schalter). Ein Bereich
                     mit kachel:false steht nur in der Leiste, nicht im
                     Raster der Startseite
js/start.js          die Startseite mit der Bereichsauswahl
js/feed.js           der Feed: Beiträge, Umfragen, Herz, Kommentare
js/formulare.js      Spesen- und Ferienanträge
js/abnahme.js        die Bauabnahme: Plan, Mängel, Abschluss
js/protokolle.js     die Sitzungsprotokolle eines Projekts als Liste
js/protokoll.js      ein Sitzungsprotokoll: Kopfdaten, Teilnehmende,
                     Traktanden, Abschluss, Teilen
js/store.js          Datenzugriff Baujournal, lokaler Spiegel,
                     Offline-Warteschlange
js/projekte.js js/projekt.js js/projekt-start.js
js/journal.js js/eintrag.js js/papierkorb.js
js/verlauf.js        Eintragszeile und Filter, geteilt von Startseite
                     und Papierkorb
js/export.js         PDF und Word
js/mitarbeiter.js js/firmenpool.js js/dokumente.js
js/papierkorb-bereich.js
js/projekte-daten.js  alles, was mehrere Seiten über Projekte wissen
                      müssen: Statusnamen, Beträge, Abfragen, das
                      Stammdaten-Formular. Hängt an einem globalen
                      Namen (PJ), weil ladeProjekte() im Baujournal
                      schon vergeben ist
js/projekte-bereich.js js/projekt-detail.js js/pendenzen.js
js/suche.js           die globale Suche
js/profil.js          Mein Profil: eigene Kontaktdaten, Unterschrift
                      auf einem Canvas erfassen und zuschneiden
js/chat.js            der Chat: Liste, Gespräch, Echtzeit, Gruppen, Löschen
js/push.js            Benachrichtigungen, ohne Bezug zu einem Bereich
css/chat.css          die zwei Spalten des Chats
api/push.js           verschickt eine Meldung an die anderen Mitglieder
api/_webpush.js       Web Push von Hand: Verschlüsselung nach RFC 8291,
                      VAPID nach RFC 8292. Der Unterstrich haelt die
                      Datei aus dem Routing von Vercel heraus
api/chat-aufraeumen.js  taeglicher Cron: abgelaufene Bilder loeschen
css/protokoll.css     die Übersicht und der Protokoll-Screen
css/projekte.css      Statusmarken und Karten des Bereichs Projekte.
                      Liegt auch auf mitarbeiter.html, wegen der Marke
                      für die Berechtigungsstufe
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
`pj-`, `pk-`, `st-`), und für genau diese Präfixe steht `border-box` an einer Stelle in
`css/app.css`. Ohne das läuft jede Zeile mit `width:100%` und seitlichem Polster
um dieses Polster aus dem Bild.

## Datenbank

Supabase-Projekt `baujournal-triga`, Region `eu-central-1`. Eine Datenbank für
alle acht Bereiche.

- `projekte` — Stammdaten, `kontrollpunkte` und `gebaeude` als JSON-Listen,
  `beschrieb`, `status` (planung / laufend / abgeschlossen) und `archiviert`.
  Die Adresse steht in `standort`: die Spalte heisst historisch so, weil das
  Baujournal sie als Untertitel führt, und ist im Formular seit jeher mit
  «Standort / Adresse» beschriftet. Eine zweite Spalte dafür wäre ein zweiter
  Ort zum Pflegen
- `projekteinsaetze` — die Unternehmerliste: Projekt, Firma, `gewerk` als
  BKP-Code, `status` (angefragt / offeriert / beauftragt / ausgeführt) und die
  optionale `auftragssumme`
- `projekt_mitarbeiter` — wer auf einem Projekt zuständig ist, mit `rolle`
- `pendenzen` — offene Punkte eines Projekts: `beschrieb`, optional `firma_id`,
  `erledigt_am` und `erledigt_von`. Ob eine Pendenz erledigt ist, steht in genau
  einem Feld, `erledigt_am` — dasselbe Muster wie `geloescht_am`. Eine zweite
  Status-Spalte daneben wäre eine zweite Wahrheit
- `eintraege` — ein Rundgang, `kontrolle` als JSON mit der kompletten
  Punkteliste, `betrifft_gebaeude` als JSON-Liste, `geloescht_am` und
  `geloescht_von` für den Papierkorb
- `eintraege_korrekturen` — das Korrekturprotokoll, nur lesen und anhängen
- `profile` — Anzeigename je Konto, weil `auth.users` vom Client aus nicht
  lesbar ist. Wird automatisch angelegt, sobald ein Konto entsteht
- `mitarbeiter` — das Adressbuch des Teams, bewusst getrennt von den
  Login-Konten. Einen Eintrag zu löschen berührt kein Konto. `berechtigung`
  hält die Stufe (`mitarbeiter`, `geschaeftsleitung` oder `entwickler`) und
  heisst absichtlich nicht `rolle`: die Spalte `rolle` trägt schon die Funktion
  im Betrieb («Bauleiter», «Administration»). `user_id` verknüpft die Zeile mit
  dem Login-Konto, `unterschrift` hält die im Profil erfasste Unterschrift als
  PNG in einer Data-URL
- `ordner`, `dateien` — die Dokumentenablage, die PDF selbst liegt im
  Storage-Bucket `dokumente`. Ein Ordner darf ein `projekt_id` tragen, die
  Dateien darin erben die Zuordnung über ihren Ordner und haben bewusst kein
  eigenes Feld: eine Datei liegt nur an einem Ort
- `bkp_liste` — die BKP-Kategorien des Firmenpools, als Daten und nicht
  hart codiert
- `firmen` — nur der Name ist Pflicht, die BKP-Codes stehen als
  JSON-Liste im Feld `bkp_codes`
- `ansprechpersonen`, `notizen` — Unterdetails einer Firma. Eine Notiz darf ein
  `projekt_id` tragen; ohne gilt sie allgemein für die Firma
- `feed_beitraege`, `feed_optionen`, `feed_stimmen`, `feed_reaktionen`,
  `feed_kommentare` — der Feed. Beitrag und Umfrage stehen in derselben
  Tabelle, unterschieden durch `art`; Prüfregeln halten auseinander, was nur zu
  einer Art gehört. Der Primärschlüssel `(beitrag_id, user_id)` auf
  `feed_stimmen` sorgt dafür, dass niemand zweimal abstimmt, und die Policy
  darauf gibt bei einer anonymen Umfrage keine fremde Zeile heraus. Gezählt
  wird mit `feed_ergebnisse()`, das nur Zahlen zurückgibt. Ein Foto liegt im
  Bucket `feed-bilder` unter `<beitrag_id>/<zufall>`, mit derselben
  30-Tage-Regel wie im Chat
- `feed_bilder` — die Fotos eines Beitrags, mehrere je Beitrag, sortiert nach
  `reihenfolge`. `bild_pfad` und `bild_ablauf` heissen hier gleich wie in
  `nachrichten`, damit `api/_bilder.js` unverändert auch hier aufräumt. Am
  Beitrag selbst steht nur noch `bild_ablauf` und sagt, dass er Fotos trägt —
  daran hängt die Prüfregel, dass ein Beitrag Text oder Fotos braucht
- `antraege` — Spesen und Ferien in einer Tabelle, unterschieden durch `art`;
  eine Prüfregel hält auseinander, was nur zur einen Art gehört. `status` geht
  von `eingereicht` zu `genehmigt` oder `abgelehnt` und nie zurück. Der Trigger
  `antrag_schutz()` lässt beim Entscheiden nur den Entscheid durch, nicht den
  Inhalt — den Betrag eines fremden Antrags kann auch die Geschäftsleitung
  nicht mitändern
- `abnahmen`, `maengel` — die Bauabnahme. `plan_bild_pfad` zeigt auf die einmal
  gerenderte Fassung des Grundrisses im Bucket `abnahme`; `x` und `y` eines
  Mangels stehen als Anteil zwischen 0 und 1 und nicht in Pixeln, damit die
  Nadel auf dem Handy und am Bildschirm am selben Fleck sitzt. Sobald
  `abgeschlossen_am` steht, sperrt der Trigger `abnahme_gesperrt()` beide
  Tabellen: kein Mangel kommt dazu, keiner verschwindet, keiner ändert sich
- `protokolle`, `protokoll_teilnehmer`, `protokoll_traktanden` — die
  Sitzungsprotokolle. Die `nummer` läuft pro Projekt und vergibt der Trigger
  `protokoll_nummer()`, nicht die App: zwei Geräte, die im selben Moment
  anlegen, bekämen sonst beide die 13. Ein Traktandum trägt `reihenfolge` und
  keine Nummer — die angezeigte Zahl ist die Position in der Liste, sonst
  müsste beim Verschieben jede Zahl darunter mitwandern. Getauscht wird mit
  `traktandum_schieben()`, in einem Zug. Teilnehmende tragen `name` und `firma`
  zusätzlich als Momentaufnahme, damit ein Protokoll lesbar bleibt, wenn die
  Person später umbenannt oder aus dem Adressbuch entfernt wird. Sobald
  `abgeschlossen_am` steht, sperrt `protokoll_gesperrt()` alle drei Tabellen
- `chats`, `chat_mitglieder`, `nachrichten` — der Chat. Ein Bild liegt im Bucket
  `chat-bilder` unter `<chat_id>/<zufall>`, der Pfad steht in
  `nachrichten.bild_pfad`. Läuft es ab, wird der Pfad geleert und
  `bild_ablauf` bleibt stehen — daran erkennt die App den Unterschied
  zwischen «war nie ein Bild» und «Bild ist weg»
- `push_geraete` — ein Abo je Gerät und Browser. Bewusst ohne Bezug zu einem
  Bereich: wenn später eine zugewiesene Pendenz melden soll, braucht es hier
  keine Zeile mehr

Auf allen Tabellen ist Row Level Security aktiv, jede Policy verlangt die
Rolle `authenticated`. Ohne Login liefert jede Abfrage leer zurück. Alle
Teammitglieder sehen alles und dürfen überall erfassen — mit einer Ausnahme,
`mitarbeiter`, siehe den nächsten Abschnitt.

### Schreibschutz auf `mitarbeiter`

Diese eine Tabelle hält mehr als Adressen: die Berechtigungsstufe steht darin.
Wäre sie so offen wie die anderen, könnte sich jede angemeldete Person mit einem
einzigen Aufruf gegen die API selbst auf `entwickler` setzen. Dass «Mein Profil»
nur die eigene Zeile anfasst, ist eine Regel der Oberfläche — und eine Regel, die
nur in der Oberfläche steht, gilt für niemanden, der die Oberfläche umgeht.

Zwei Schranken, weil RLS und Spalten zwei verschiedene Dinge sind: die Policy
entscheidet, **welche Zeile**, der Trigger `mitarbeiter_schutz()`, **welche
Spalte**.

| | ohne erweiterte Stufe | mit erweiterter Stufe |
|---|---|---|
| eigene Zeile: `telefon`, `email`, `unterschrift` | ja | ja |
| eigene Zeile: `name`, `rolle`, `berechtigung`, Papierkorb | nein | ja |
| fremde Zeile | nein, die Policy trifft sie gar nicht | ja |
| Person anlegen | nein | ja |
| lesen | alles | alles |

Die Spaltenliste im Trigger zählt auf, **was erlaubt ist**, nicht was verboten
ist. Kommt später eine Spalte dazu, ist sie damit von selbst geschützt; bei einer
Verbotsliste wäre sie von selbst offen, und das fiele niemandem auf.

`ist_berechtigt()` läuft als `security definer`. Das ist hier Pflicht und kein
Nachlassen: die Funktion wird aus einer Policy auf `mitarbeiter` gerufen und liest
dieselbe Tabelle — ohne den Umweg am RLS vorbei prüfte die Policy sich selbst.
Der `search_path` steht fest, damit ihr niemand eine eigene Tabelle unterschiebt.

Ohne angemeldetes Konto greift der Trigger bewusst nicht: aus dem
Supabase-Dashboard und über den Service-Key bleibt alles möglich, sonst käme die
Administration an die eigene Tabelle nicht mehr heran. Das ist auch der Weg für
den Erstaufbau — in einer leeren Tabelle gibt es niemanden mit erweiterter Stufe,
also legt die erste Person das Dashboard an. Genauso wie die Login-Konten, die
ohnehin nur dort entstehen.

Die Oberfläche zieht nach, statt Knöpfe hinzustellen, die verlässlich scheitern:
ohne erweiterte Stufe zeigt der Bereich Mitarbeiter kein Plus, kein Bearbeiten
und keinen Papierkorb, und der Papierkorb kein «Wiederherstellen». Auf der
eigenen Zeile steht stattdessen der Weg zu «Mein Profil». Was die Oberfläche
anbietet, entscheidet `darfVerwalten()` aus `js/app.js` — was wirklich zählt,
entscheidet die Datenbank.

### Die Stufen

Drei Stufen: `mitarbeiter`, `geschaeftsleitung`, `entwickler`. **Entwickler darf
dasselbe wie die Geschäftsleitung** — Beiträge anderer löschen, Anträge
genehmigen, und was sonst noch dazukommt. Wer das abfragt, ruft `istBerechtigt()`
aus `js/app.js` auf und schreibt nirgends `berechtigung === 'geschaeftsleitung'`
hin. Stünde die Regel an jedem Knopf einzeln, hätte irgendein Bildschirm die
dritte Stufe früher oder später vergessen. Die Namen der Stufen stehen daneben
in `STUFEN`. Gespeicherter Wert und Bildschirmtext sind nicht dasselbe: in der
Tabelle steht `mitarbeiter`, angezeigt wird «Mitarbeiter:in». Wer den Text
ändert, ändert `STUFEN` und sonst nichts — die Datenbank bleibt, wo sie ist.

**Das Abzeichen kann etwas anderes sagen als die Stufe.** `badge_label` ist ein
optionaler Text pro Person; steht er da, zeigt ihn das Abzeichen statt des
Stufennamens (`badgeTitel()` in `js/app.js`). An den Rechten ändert das nichts,
die hängen weiter allein an `berechtigung`. Der Anlass war die Administration:
sie braucht die Rechte der Geschäftsleitung, gehört ihr aber nicht an, und ein
Abzeichen «Geschäftsleitung» neben der Funktion «Administration» behauptet
etwas Falsches über die Person. Eine vierte Stufe wäre die schlechtere Antwort
gewesen — zwei Stufen mit exakt denselben Rechten driften früher oder später
auseinander. Pflegen darf den Text, wer auch die Stufe vergibt; dafür brauchte
es keine neue Regel, weil `mitarbeiter_schutz()` eine Liste des Erlaubten führt
und eine neue Spalte damit von sich aus geschützt ist.

Gelöscht wird nirgends wirklich. `projekte`, `eintraege`, `mitarbeiter`,
`ordner`, `dateien`, `bkp_liste` und `firmen` tragen `geloescht_am` und
`geloescht_von` und haben schlicht keine Delete-Policy: ein DELETE über die
API trifft dort null Zeilen. Wer und wann gelöscht hat, trägt der Trigger
`setze_loeschspur()` serverseitig ein, der Client kann das nicht fälschen.
Die Ausnahmen sind `ansprechpersonen`, `notizen`, `pendenzen`,
`projekteinsaetze` und `projekt_mitarbeiter`: Unterdetails, die zu genau einem
Datensatz gehören und bewusst direkt löschbar sind.

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

## Feed

**Ein Beitrag und eine Umfrage stehen in derselben Tabelle.** `feed_beitraege`
trägt beide, unterschieden durch `art`. Der Grund ist der gemeinsame Strom: sie
stehen chronologisch nebeneinander, tragen dieselben Herzen und dieselben
Kommentare. Zwei Tabellen hiessen jede Abfrage zweimal und die Sortierung von
Hand zusammengesetzt. Die Prüfregeln in der Migration halten trotzdem sauber
auseinander, was nur zur einen Art gehört: eine Kategorie hat nur der Beitrag,
ein Projekt auch, `anonym` nur die Umfrage.

**Die Anonymität kommt nicht daher, dass die App Namen verschweigt.**
`feed_stimmen` muss festhalten, wer abgestimmt hat, sonst liesse sich eine
zweite Stimme nicht verhindern — der Primärschlüssel `(beitrag_id, user_id)`
macht genau das. Herausgegeben werden diese Zeilen aber nie: die Policy zeigt
bei einer anonymen Umfrage jeder Person nur ihre eigene, auch der, die die
Umfrage angelegt hat. Gezählt wird in der Datenbank, mit
`feed_ergebnisse()`, und von dort kommen ausschliesslich Zahlen zurück. Auf der
Datenbank nachgestellt und bestätigt: als erstellende Person 0 von 3
Stimmzeilen sichtbar, die Auswertung trotzdem vollständig.

**Hier wird wirklich gelöscht, ohne Papierkorb.** Das ist der einzige Bereich,
in dem das so ist, und es ist gewollt: ein Beitrag ist kein Dokument mit
Aufbewahrungsfrist, wer sich vertippt, postet neu. Die Regel auf `eintraege`
bleibt davon unberührt, dort gibt es weiterhin keine Delete-Policy.
Löschen darf, wer geschrieben hat, und zusätzlich die erweiterte Stufe
(`ist_berechtigt()`) — als einfache Moderation, für Beiträge und Kommentare
gleichermassen. Wer einen ganzen Beitrag entfernen darf, soll nicht den Umweg
gehen müssen, den Beitrag zu löschen, um einen Kommentar loszuwerden.

**Ein Beitrag trägt beliebig viele Fotos**, bis zu zehn. Sie stehen in
`feed_bilder` und nicht als Spalten am Beitrag: eine Spalte pro Foto wäre eine
Grenze, die man einmal festlegt und danach bereut. Im Feed liegen sie
nebeneinander in einer Spur, durch die man wischt; darunter zeigen Punkte, wo
man gerade ist, und am Schreibtisch gibt es zwei Pfeile dazu, weil dort niemand
wischt. Beiträge, die vor dieser Änderung ein einzelnes Foto trugen, sind mit
der Migration in dieselbe Tabelle gewandert und sehen aus wie vorher.

**Fotos leben 30 Tage, genau wie im Chat.** Und zwar über denselben Ablauf:
`api/_bilder.js` enthält ihn einmal, `api/chat-aufraeumen.js` und
`api/feed-aufraeumen.js` rufen ihn mit ihren eigenen Namen auf. Zwei Kopien
wären zwei Orte, an denen jemand später etwas ändert und den anderen vergisst.
Die Frist steht deshalb an jeder Fotozeile und trägt dieselben Spaltennamen wie
im Chat — so genügte beim Umbau auf mehrere Fotos der andere Tabellenname.

**Erwähnungen stehen im Text selbst,** als `@[Name](Kennung)`. Nicht in einer
eigenen Tabelle daneben: der Text ist die Wahrheit, und wer nachsehen will, wer
wirklich erwähnt wurde — `api/push.js` tut das —, liest dieselbe Zeichenkette
wie der Bildschirm. Eine zweite Tabelle liefe früher oder später auseinander,
etwa wenn jemand den Namen aus dem Text löscht. Der Name steht mit drin, obwohl
die Kennung genügte: damit der Text auch dort lesbar bleibt, wo niemand das
Adressbuch zur Hand hat, etwa in der Meldung auf dem Sperrbildschirm.

Im Eingabefeld selbst steht immer nur der Name. Wer `@` tippt, bekommt eine
Auswahlliste; was daraus gewählt wurde, merkt sich die App und setzt beim
Absenden die Klammern. Niemand soll beim Schreiben Kennungen vor sich haben.

**Vier Wege gehen durch `api/push.js`:** ein Gespräch, ein Feed-Beitrag, ein
Feed-Kommentar und ein entschiedener Antrag. Welcher gilt, sagt genau eines der
Felder `chat`, `beitrag`, `kommentar` oder `antrag`; wer melden darf und an
wen, liest die Funktion jedes Mal selbst nach.

**Zwei Gründe melden sich: «Wichtig» und eine Erwähnung.** Wer etwas mit der
Kategorie «Wichtig» postet, löst bei allen anderen im Adressbuch eine
Push-Meldung aus — über dieselbe Funktion und dieselbe Tabelle `push_geraete`
wie der Chat. Ein Update oder ein Kommentar melden sich nur bei den Personen,
die darin erwähnt werden. Eine Umfrage meldet nie, auch nicht mit einer
Erwähnung darin: sie richtet sich an alle, sonst wäre es keine. Stünde jedes
Update auf dem Telefon, wäre «Wichtig» nach zwei Wochen nichts mehr wert.

Beides zugleich ergibt trotzdem nur eine Meldung: bei einem wichtigen Beitrag
mit Erwähnung sind die Erwähnten schon unter «alle», und zwei Meldungen zum
selben Beitrag wären eine zu viel.

Entschieden wird das alles in `api/push.js` und nicht in der App: die Funktion
sieht selbst nach, ob der Beitrag oder der Kommentar der aufrufenden Person
gehört, welche Kategorie er trägt und wer im gespeicherten Text wirklich
erwähnt wird. Die Kennungen werden zusätzlich mit dem Adressbuch geschnitten —
an eine frei erfundene Kennung geht nichts. Wer den Aufruf von Hand nachbaut,
kommt damit nicht weiter.

**Der Feed läuft in Echtzeit,** wie der Chat. Neue Beiträge, Umfragen, Herzen
und Kommentare erscheinen ohne Neuladen. Eine Besonderheit gibt es bei den
Stimmen: `feed_stimmen` steht bewusst nicht in der Veröffentlichung, denn die
Echtzeit hält sich an dieselbe Policy wie jede Abfrage — bei einer anonymen
Umfrage käme eine Stimme bei niemandem an ausser bei der Person, die sie
abgegeben hat, und das Ergebnis stünde bei allen anderen still. Die App meldet
eine neue Stimme deshalb als Rundruf über den Kanal, mit nichts als der Kennung
der Umfrage, und jeder holt sich daraufhin das Ergebnis mit
`feed_ergebnisse()`. Verraten wird damit nur, was die Balken ohnehin zeigen.

Weil jede eigene Änderung über die Echtzeit zurückkommt — und nicht unbedingt
erst nach der Antwort auf das Einfügen —, prüft jede Stelle, die etwas in die
Listen legt, ob sie es nicht schon kennt (`merke()` in `js/feed.js`). Ohne das
stand ein Beitrag zweimal da, mit allem, was daran hing.

**Der Feed hat keine Kachel auf der Startseite,** er steht zuoberst in der
Seitenleiste. So zeigt es die Design-Referenz. Auf dem Handy gibt es die
Seitenleiste aber nicht, und ohne einen Weg dorthin wäre der Bereich auf dem
Telefon nicht erreichbar — deshalb die eine Zeile über den Kacheln
(`.st-feed`). Kein siebtes Feld im Raster, sondern ein Einstieg, der sich davon
deutlich unterscheidet.

## Formulare und Bauabnahme

**Ein Antrag und eine Abnahme laufen auf denselben Gedanken hinaus:** etwas
wird erfasst, jemand entscheidet oder unterschreibt, und danach ist es ein
Nachweis und kein Entwurf mehr. Das steht in der Datenbank und nicht nur in der
Oberfläche — ein entschiedener Antrag und eine unterschriebene Abnahme lassen
sich auch dann nicht mehr ändern, wenn jemand die App umgeht.

Beim Antrag macht das der Trigger `antrag_schutz()` mit einer Erlaubnisliste,
derselben Bauart wie `mitarbeiter_schutz()`: durch darf nur der Entscheid, und
`entschieden_von` setzt der Trigger selbst auf `auth.uid()`. Wer entscheidet,
kann den Betrag eines fremden Antrags damit nicht mitändern. Bei der Abnahme
macht es `abnahme_gesperrt()` — als Trigger und nicht als Policy, weil eine
Policy, die keine Zeile trifft, schweigt; hier soll eine Meldung erscheinen,
damit klar wird, warum nichts passiert.

**Warum der Grundriss als Bild und nicht als PDF:** auf ein PDF lässt sich keine
Stecknadel zuverlässig setzen. Die Anzeige skaliert, scrollt und rendert je nach
Gerät anders, und eine Position in Pixeln wäre morgen eine andere Stelle. Die
gewählte Seite wird deshalb einmal zu einem PNG gerendert und liegt danach fest
im Bucket `abnahme`. Jede Nadel steht als Anteil der Bildbreite und -höhe
zwischen 0 und 1 und sitzt damit auf jedem Bildschirm am selben Fleck.

Gerendert wird mit **pdf.js im Browser**, aus `vendor/`, beim ersten Öffnen der
Abnahme. Der Spec sah dafür einen Server vor; diese App hat aber keinen
Build-Schritt und keine npm-Abhängigkeiten, und ein PDF im Serverless-Umfeld zu
rastern verlangt beides. Das Ergebnis ist dasselbe: ein Bild, einmal erzeugt,
danach für alle und jedes Gerät gleich. `vendor/pdfjs-worker-…` liegt bewusst
nicht im Vorab-Cache des Service Workers — es ist gut ein Megabyte, und ohne
Verbindung liesse sich der Plan ohnehin nicht laden.

**Das Protokoll** entsteht vor dem Abschluss und nicht danach: die Datenbank
sperrt eine abgeschlossene Abnahme, die Kennung der Datei liesse sich sonst
nicht mehr eintragen. Es liegt als PDF im Bereich Dokumente des Projekts, im
vorhandenen Ordner oder in einem neu angelegten, mit dem Plan samt Nadeln,
allen Mängeln mit Foto und Frist und beiden Unterschriften. Erzeugt wird es von
`abnahmeProtokoll()` in `js/export.js`, wo die ganze PDF-Maschinerie schon liegt.

Das **Feld zum Unterschreiben** steht in `js/app.js` als `unterschriftErfassen()`
und wird von zwei Orten gebraucht: unter «Mein Profil» für die eigene
Unterschrift und bei der Abnahme für die Bauherrschaft, die kein Konto in dieser
App hat. Zwei Fassungen desselben Felds liefen früher oder später auseinander,
und dann sähe eine Unterschrift im Protokoll anders aus als im Profil.

## Sitzungsprotokolle

**Derselbe Gedanke wie bei der Abnahme:** vorbereiten, in der Sitzung füllen,
am Schluss abschliessen — und danach ist es ein Nachweis. Die drei Zustände
heissen *Vorbereitet*, *Entwurf* und *Abgeschlossen*.

**Der Wechsel von Vorbereitet auf Entwurf hat bewusst keinen Knopf.** Sobald
zum ersten Mal etwas festgehalten wird — Text, Beschluss, Foto, Pendenz oder
die Anwesenheit einer Person —, hat die Sitzung offensichtlich stattgefunden.
Ein eigener Schalter dafür wäre einer, den man vergisst, und dann stünde in der
Übersicht «noch nicht durchgeführt», während das Protokoll voller Text ist.

**Eine Pendenz aus einem Traktandum geht in die bestehende Pendenzenliste des
Projekts**, nicht in eine zweite daneben. Am Traktandum bleibt nur der Verweis,
damit das fertige Protokoll sagen kann, was aus der Sitzung an Arbeit
hervorgegangen ist. Der Beschrieb wird aus dem Traktandumstext vorgeschlagen und
bleibt änderbar.

Daraus folgt eine einzige Lücke in der Sperre: verschwindet eine Pendenz aus der
Projektliste, darf ihre Spur im Traktandum verblassen, auch wenn das Protokoll
längst abgeschlossen ist. Ohne diese Ausnahme liesse sich eine Pendenz, die
einmal aus einem fertigen Protokoll entstanden ist, nie mehr löschen — das
Aufräumen des Fremdschlüssels würde an der Sperre scheitern. Erlaubt ist
ausschliesslich dieser eine Schritt, geprüft als Erlaubnisliste wie bei
`antrag_schutz()`.

**Das PDF** entsteht vor dem Abschluss, aus demselben Grund wie beim
Abnahmeprotokoll: die Datenbank sperrt ein abgeschlossenes Protokoll, die
Kennung der Datei liesse sich sonst nicht mehr eintragen. Es enthält die
Kopfdaten, die Teilnehmerliste mit Status, alle Traktanden mit Text und Foto und
am Schluss die beiden Listen, wegen derer jemand ein Protokoll zwei Wochen
später nochmals aufmacht: was wurde entschieden, und was ist davon Arbeit
geworden. Erzeugt wird es von `sitzungsProtokoll()` in `js/export.js` und liegt
im Bereich Dokumente des Projekts.

**Geteilt wird über das Gerät, nicht über einen Mailversand.** Ein eingebauter
Versand bräuchte eine bezahlte Infrastruktur, die für diese Testphase nicht
gerechtfertigt ist. Die Web Share API reicht das PDF als Datei an jede App
weiter, auch ans Mailprogramm. Wo es sie nicht gibt — mancher Browser am
Schreibtisch kennt sie nicht —, wird die Datei heruntergeladen.

**Gelöscht** wird ohne Papierkorb, wie bei den Pendenzen: ein vorbereitetes oder
begonnenes Protokoll ist in Sekunden neu angelegt. Ein abgeschlossenes lässt
sich gar nicht mehr löschen, das PDF ist der massgebende Nachweis. Dasselbe gilt
für einzelne Traktanden.

## Chat und Benachrichtigungen

**Wer mitreden darf, steht an genau einem Ort:** `chat_mitglieder`. Daran hängt
alles — welche Gespräche jemand sieht (`ist_chat_mitglied()` in jeder Policy),
welche Nachrichten er liest, und sogar der Zugriff auf die Bilder: sie liegen
unter der Gesprächs-ID als erstem Ordner, und die Storage-Policy fragt dieselbe
Funktion. Wer aus einer Gruppe fliegt, verliert damit auch die Bilder daraus,
ohne dass irgendwo ein zweiter Schalter umgelegt werden müsste.

Eintragen darf, wer das Gespräch angelegt hat — beim Anlegen selbst und
später beim Hinzufügen weiterer Personen. Dafür gibt es `ist_chat_ersteller()`,
und zwar mit `security definer`, aus einem Grund, der einmal Geld gekostet hat:
**eine Policy darf keine Tabelle mit RLS direkt lesen.** Die erste Fassung
prüfte die Berechtigung mit einer Unterabfrage auf `chats` — die lief selbst
durch `chats_select`, das Mitgliedschaft verlangt, und im Moment der allerersten
Mitgliederzeile ist noch niemand Mitglied. Die Regel biss sich selbst, und kein
Gespräch liess sich anlegen. Wer aus einer Policy heraus eine geschützte Tabelle
lesen muss, geht über eine Funktion mit `security definer`.

**Der Ungelesen-Zähler steht nirgends als Zahl.** Er ist die Anzahl Nachrichten
nach `chat_mitglieder.zuletzt_gelesen`. Eine gepflegte Zahl daneben würde beim
ersten verlorenen Update abweichen, und niemand merkte es.

**Die Lesebestätigung rechnet aus derselben Spalte.** Ein Haken heisst: in der
Datenbank angekommen. Zwei heissen: alle anderen Mitglieder haben gelesen,
ihr `zuletzt_gelesen` liegt also nicht vor dem Sendezeitpunkt. In der Gruppe
gilt das erst, wenn es auf **alle** zutrifft — sonst hiesse «gelesen» bei zwei
Leuten etwas anderes als bei fünf. Eine Spalte pro Nachricht oder eine eigene
Tabelle gibt es dafür bewusst nicht: das wäre ein zweiter Ort für dieselbe
Wahrheit, und zwei Orte driften auseinander. Wer genau gelesen hat, steht
nirgends; das ist eine Arbeitsgruppe und kein Leseprotokoll.

**Löschen** gibt es in zwei Formen, und sie funktionieren verschieden. Eine
einzelne Nachricht löscht nur, wer sie geschrieben hat: Policy
`nachrichten_update` erlaubt die Änderung überhaupt, der Trigger
`nachricht_nur_loeschen()` lässt genau eine davon durch — Inhalt raus,
`geloescht_am` rein. Ohne den Trigger wäre aus dem Löschen ein Bearbeiten
geworden. Ein ganzes Gespräch löscht jedes Mitglied (`chats_delete`), und die
Fremdschlüssel nehmen Mitgliedschaften und Nachrichten mit. Die Bilder im
Bucket gehen **zuerst**: danach ist die Mitgliedschaft weg, und ohne sie lässt
die Storage-Policy keine Datei mehr entfernen — sie läge für immer dort, ohne
dass noch eine Zeile auf sie zeigt.

**Echtzeit** läuft über die Postgres-Publikation `supabase_realtime`, auf der
`nachrichten` und `chat_mitglieder` liegen. Zwei Kanäle mit verschiedenen
Aufgaben: einer für das offene Gespräch, einer für die Liste. Der zweite bleibt
bestehen, während man von Chat zu Chat springt — sonst verpasste man neue
Nachrichten in allen anderen Gesprächen.

**Push-Benachrichtigungen** sind eine eigenständige Grundlage, nicht Teil des
Chats. `js/push.js` kennt vier Funktionen — fragen, anmelden, abmelden, senden —
und keine davon weiss, was ein Chat ist. Beim ersten Öffnen des Chats wird
einmal gefragt, mit Begründung; wer ablehnt, wird nicht wieder gefragt und
merkt sonst nichts.

Der Versand steckt in `api/push.js`, weil zwei Dinge nicht in einen Browser
gehören: der private VAPID-Schlüssel und die Abos anderer Leute. Die Funktion
nimmt das Zugangs-Token der sendenden Person und fragt damit **selbst** bei
Supabase nach den Mitgliedern — steht die Person nicht drin, liefert RLS eine
leere Liste und es passiert nichts. Erst danach kommt der Dienstschlüssel zum
Zug, und nur für die so ermittelten Geräte.

**Jede Anfrage an Supabase trägt zwei Köpfe, und sie bedeuten Verschiedenes:**
`apikey` weist das Projekt aus, `Authorization` die Person. Der `apikey` muss
einer der Schlüssel des Projekts sein — anon key oder Dienstschlüssel. Ein
Zugangs-Token ist keiner, und das Tor vor der Datenbank weist eine Anfrage mit
einem solchen `apikey` ab. Genau das stand hier einmal in beiden Köpfen, mit
der Folge, dass `api/push.js` „kein Zugriff auf dieses Gespräch" meldete,
obwohl die Person das Gespräch gerade eben beschrieben hatte.

**Der Dienstschlüssel muss wirklich der Dienstschlüssel sein.** Nur die Rolle
`service_role` sieht die Geräte *anderer* Leute; jeder andere Schlüssel liest
`push_geraete` unter der Zeilensicherheit und bekommt dann keine Fehlermeldung,
sondern eine **leere Liste**. Von aussen sieht das aus, als hätte niemand ein
Gerät angemeldet — obwohl die Zeilen da sind. `api/push.js` liest deshalb bei
jedem Aufruf die Rolle aus dem Schlüssel und schreibt es ins Log, wenn sie nicht
stimmt.

**Die Anmeldung eines Geräts sagt, wenn sie scheitert.** `pushAnmelden()` in
`js/push.js` hat früher jeden Fehler verschluckt und `false` zurückgegeben:
kein Abo beim Dienst, keine Sitzung, ein abgelehnter Schreibversuch — alles sah
gleich aus, nämlich nach nichts. Wer gerade auf «erlauben» getippt hatte,
glaubte, es sei eingerichtet. Jetzt nennt jeder Schritt seinen Grund, in der
Konsole immer und auf dem Bildschirm dann, wenn die Person es selbst ausgelöst
hat. Ein bestehendes Abo wird dabei weiterverwendet, und eines, das noch auf
einen alten VAPID-Schlüssel lautet, vorher weggeräumt.

**Jede Absage schreibt eine Zeile ins Log.** Eine Funktion, die 403 antwortet
und sonst schweigt, sieht in den Vercel-Logs aus wie eine, die gar nicht erst
gelaufen ist — „No logs found for this request". Deshalb nennt jeder Abbruch
in `api/push.js` den Grund und, wo es einen gibt, den Status und die Antwort
von Supabase. Auch der Browser schweigt nicht mehr: bleibt `/api/push` ohne
Erfolg, steht das in der Konsole. Auf die Nachricht selbst hat das keinen
Einfluss, die ist längst zugestellt.

`api/_webpush.js` macht die Kryptografie von Hand: Verschlüsselung nach
RFC 8291, VAPID-Token nach RFC 8292, beides mit der WebCrypto-Schnittstelle von
Node. Es gäbe dafür ein fertiges npm-Paket, aber dieses Repo kommt seit jeher
ohne Build-Schritt und ohne Abhängigkeiten aus. Beide RFC bringen Testvektoren
mit, und die Prüfung rechnet das Beispiel aus RFC 8291 nach und vergleicht
Byte für Byte — das ist mehr Sicherheit, als ein Paket-Update je gäbe.

Die drei Umgebungsvariablen dazu stehen weiter unten unter
[Umgebungsvariablen](#umgebungsvariablen), zusammen mit der von search.ch —
eine Liste, ein Ort.

**Der 30-Tage-Ablauf** hängt an einem Cron-Eintrag in `vercel.json`, der täglich
`api/chat-aufraeumen` ruft. Erst die Datei, dann die Zeile — in dieser
Reihenfolge, weil der umgekehrte Weg im Fehlerfall eine Datei zurückliesse, die
niemand mehr findet. So bleibt beim Abbruch höchstens ein Eintrag stehen, den
der nächste Lauf erneut aufgreift.

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

Vier, alle in den Projekteinstellungen von Vercel und keine davon im Repo:

| Name | Wofür |
|---|---|
| `SEARCH_CH_API_KEY` | Schlüssel für die Tel-API von search.ch |
| `VAPID_PRIVAT` | signiert Push-Benachrichtigungen. Gegenstück zu `BJ_CONFIG.vapid` im Client |
| `VAPID_ABSENDER` | `mailto:`-Adresse, die der Push-Dienst im Störungsfall anschreibt |
| `SUPABASE_SERVICE_KEY` | liest die Push-Abos der anderen und räumt abgelaufene Chat-Bilder weg |

Jede fehlende Variable schaltet genau ihren Teil ab und sonst nichts: ohne
VAPID kommen keine Benachrichtigungen, der Chat läuft weiter; ohne
Dienstschlüssel bleiben abgelaufene Bilder liegen, bis er da ist.

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

Die hochgezählte Version genügt jetzt auch. Früher lag zwischen dem Ausliefern
und dem, was auf dem Gerät zu sehen war, noch mindestens ein Neuladen von Hand:
das offene Fenster hatte seine Dateien schon aus dem alten Cache, und beim
nächsten Start antwortete wieder zuerst der Cache. Auf dem Handy, wo die App als
Symbol auf dem Startbildschirm tagelang offen bleibt, konnte ein fertiger
Bereich so lange unsichtbar bleiben — beim Bereich Formulare ist genau das
passiert. Heute meldet der Worker den offenen Fenstern, dass er eine ältere
Fassung abgelöst hat, und die laden einmal neu. Nicht mitten im Tippen: läuft
gerade eine Eingabe, wartet das Neuladen, bis das Feld den Fokus abgibt.

Welche Fassung auf einem Gerät läuft, zeigen die Entwicklerwerkzeuge unter
*Application → Service Workers*; den Namen dazu trägt `VERSION` oben in `sw.js`.

# Die Testsuiten

22 Suiten mit zusammen rund 2300 Prüfungen, gefahren mit Playwright gegen
Chromium. Sie laufen nicht gegen die echte Datenbank, sondern gegen einen
handgeschriebenen Supabase-Ersatz.

## Warum ein eigener Stub und kein echter Supabase

`stub.js` tritt an die Stelle von `vendor/supabase-js`. Die Suiten leiten
den Aufruf darauf um, die App merkt nichts davon. Das hat zwei Gründe. Der
eine ist praktisch: aus der Entwicklungsumgebung ist der echte Endpunkt
gesperrt. Der andere wiegt schwerer — ein Test, der eine gemeinsame
Datenbank verändert, ist nach dem dritten Durchlauf ein anderer Test.

Der Preis dafür steht gleich dabei: **der Stub ist nur so gut wie sein
Nachbau.** Er führt die Policies, Trigger und Prüfregeln aus der Datenbank
ein zweites Mal, und jede Regel, die dort dazukommt, muss hier nachgezogen
werden. Sonst prüfen die Suiten etwas Freundlicheres als das Original.
Genau das ist schon vorgekommen: der Grundbestand kannte kein Adressbuch,
und damit lief eine Prüfung durch, die in der echten Datenbank abgewiesen
worden wäre.

Deshalb gilt: **jede Regel wird zuerst auf der echten Datenbank
nachgewiesen**, mit einem `DO`-Block, der am Schluss `raise exception`
wirft und damit alles zurückrollt. Erst danach lernt der Stub dieselbe
Regel. Der Nachweis ist das Original, der Stub die Kopie.

## Fahren

```sh
# Server für die App
cd /pfad/zum/repo && python3 -m http.server 8123 --bind 127.0.0.1 &

# Zweiter Server für die Offline-Suite: eine Kopie der App mit dem Stub
# fest eingebaut, weil der Service Worker dort mitspielen muss
sh tests/neustart8124.sh

# Alles am Stück
sh tests/lauf-alles.sh      # schreibt tests/alles.log

# Einzeln
node tests/chat.mjs
```

## Was hier noch nicht stimmt

Die Pfade in den Suiten sind absolut und auf den Container gemünzt, in dem
sie entstanden sind — `/tmp/claude-0/…/scratchpad` für die Ausgaben,
`/opt/node22/…` für Playwright, `/opt/pw-browsers/…` für Chromium. Auf
einer anderen Maschine laufen sie so nicht. Sie stehen trotzdem hier: eine
Suite mit 2300 Prüfungen, die nur in einem Container liegt, ist beim
nächsten Neustart weg.

Umzustellen wäre das an drei Stellen je Datei, und danach müsste alles
einmal komplett durchlaufen. Das ist ein eigener Schritt und keine
Nebenbei-Änderung.

## Aufbau

```
stub.js              der Supabase-Ersatz: Abfragen, Policies, Trigger,
                     Storage, Echtzeit
saat.json            der gemeinsame Anfangsbestand
lauf-alles.sh        fährt alle Suiten und schreibt alles.log
neustart8124.sh      baut die Kopie für die Offline-Suite

shell mitarbeiter dokumente firmenpool test offline durchgang
prinzipien selbsttest projekte pendenzen profil schutz chat feed
formulare abnahme protokoll wetter webpush-vektor serverfunktionen
searchch
```

`schutz` und `serverfunktionen` sind die beiden, die am ehesten etwas
finden: die eine prüft, was ein direkter Aufruf an der Oberfläche vorbei
ausrichtet, die andere die Serverless-Funktionen ohne Netz.
